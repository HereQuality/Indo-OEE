import React, { useContext, useState, useEffect } from "react";
import { Pencil, Trash2 } from "lucide-react";
import DataTable from "react-data-table-component";
import Modal from "../Components/Common/Modal";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import {
    createMenu,
    deleteMenu,
    getMenuById,
    updateMenu,
    searchMenus,
    getAllMenuGroups,
    getAllMenus,
} from "../api/menus.api";
import Select from "react-select";
import { MenuContext } from "../context/MenuContext";
import IconPicker from "../Components/Common/IconPicker";

const initialState = {
    menuName: "",
    menuGroup: "",
    menuUrl: "",
    sequence: "",
    isActive: false,
    isParent: false,
    parentMenu: null,
    icon: "",
};

const tableStyles = {
    headRow: {
        style: {
            backgroundColor: "#f8fafc",
            borderBottomWidth: "1px",
            borderBottomColor: "#e2e8f0",
            minHeight: "44px",
        },
    },
    headCells: {
        style: {
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#64748b",
        },
    },
    rows: {
        style: {
            minHeight: "54px",
            fontSize: "14px",
            color: "#334155",
        },
        highlightOnHoverStyle: {
            backgroundColor: "#f8fafc",
            transitionDuration: "0.15s",
            transitionProperty: "background-color",
            borderBottomColor: "#e2e8f0",
            outline: "none",
        },
    },
    pagination: {
        style: {
            borderTopColor: "#e2e8f0",
            color: "#64748b",
            fontSize: "13px",
        },
    },
};

// Shared react-select styling to match the app's Tailwind input look
const selectStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: "42px",
        borderRadius: "0.75rem",
        borderColor: state.isFocused ? "#3b82f6" : "#cbd5e1",
        boxShadow: state.isFocused ? "0 0 0 4px rgba(59,130,246,0.15)" : "none",
        "&:hover": { borderColor: "#3b82f6" },
    }),
    placeholder: (base) => ({ ...base, color: "#94a3b8", fontSize: "0.875rem" }),
    singleValue: (base) => ({ ...base, fontSize: "0.875rem", color: "#1e293b" }),
    menu: (base) => ({ ...base, borderRadius: "0.75rem", overflow: "hidden", zIndex: 50 }),
    option: (base, state) => ({
        ...base,
        fontSize: "0.875rem",
        backgroundColor: state.isSelected ? "#2563eb" : state.isFocused ? "#eff6ff" : "white",
        color: state.isSelected ? "white" : "#1e293b",
    }),
};

const MenuMaster = () => {
    const toast = useAlert();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true }, invalidateMenuCache, fetchMenus } = useContext(MenuContext) || {};
    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);

    const [departments, setDepartments] = useState([]);

    const [selectedMenuGroup, setSelectedMenuGroup] = useState(null);
    const [menuGroupList, setMenuGroupList] = useState([]);
    const [selectedParentMenu, setSelectedParentMenu] = useState(null);
    const [parentMenuList, setParentMenuList] = useState([]);

    const fetchMenuGroupList = async () => {
        try {
            const response = await getAllMenuGroups();
            if (response && response.data && response.data.data) {
                setMenuGroupList(response.data.data);
            }
        } catch (error) {
            console.error("Failed to fetch menu groups", error);
        }
    };

    const fetchParentMenus = async (groupId) => {
        if (!groupId) return;

        try {
            const response = await getAllMenus();

            // Check the response structure and extract the data array
            const menuData = response?.data?.data || [];

            // Build parent-child relationships and menu paths for display
            const menuMap = new Map();
            const menuHierarchy = [];

            // First, create a map of all menus
            menuData.forEach(menu => {
                if (menu.menuGroup._id === groupId || menu.menuGroup === groupId) {
                    menuMap.set(menu._id.toString(), {
                        ...menu,
                        path: menu.menuName,
                        children: []
                    });
                }
            });

            // Build hierarchy and paths
            menuData.forEach(menu => {
                if (menu.menuGroup._id === groupId || menu.menuGroup === groupId) {
                    const menuId = menu._id.toString();

                    // If menu has parent and parent exists in our map
                    if (menu.parentMenu && menuMap.has(menu.parentMenu.toString())) {
                        const parentId = menu.parentMenu.toString();
                        const parent = menuMap.get(parentId);

                        // Add this menu as child to parent
                        parent.children.push(menuId);

                        // Update path to include parent path
                        const menuWithPath = menuMap.get(menuId);
                        menuWithPath.path = `${parent.path} > ${menuWithPath.path}`;
                        menuMap.set(menuId, menuWithPath);
                    } else if (!menu.parentMenu) {
                        // Top level menu (no parent)
                        menuHierarchy.push(menuId);
                    }
                }
            });

            // Filter menus that can be parents (and aren't the current menu being edited)
            // Allow any menu to be a parent except itself (to prevent circular references)
            const validParentMenus = Array.from(menuMap.values())
                .filter(menu => {
                    // In edit mode, don't allow selecting self as parent
                    if (_id && menu._id.toString() === _id.toString()) {
                        return false;
                    }

                    // Return all menus that are marked as isParent, regardless of whether they have parents
                    return menu.isParent === true;
                })
                .map(menu => ({
                    _id: menu._id,
                    menuName: menu.path, // Use path for display to show hierarchy
                    isParent: menu.isParent
                }));

            setParentMenuList(validParentMenus);
        } catch (error) {
            console.error("Error fetching parent menus:", error);
        }
    };

    useEffect(() => {
        fetchMenuGroupList();
    }, []);

    useEffect(() => {
        if (selectedMenuGroup) {
            fetchParentMenus(selectedMenuGroup.value);
        }
    }, [selectedMenuGroup]);

    const [query, setQuery] = useState("");

    const [_id, set_Id] = useState("");
    const [remove_id, setRemove_id] = useState("");

    useEffect(() => {
        if (Object.keys(formErrors).length === 0 && isSubmit) {
            console.log("no errors");
        }
    }, [formErrors, isSubmit]);

    const [modal_list, setmodal_list] = useState(false);
    const tog_list = () => {
        setmodal_list(!modal_list);
        setValues(initialState);
        setIsSubmit(false);
    };

    const [modal_delete, setmodal_delete] = useState(false);
    const tog_delete = (_id) => {
        setmodal_delete(!modal_delete);
        setRemove_id(_id);
    };

    const [modal_edit, setmodal_edit] = useState(false);

    const handleTog_edit = (_id) => {
        setmodal_edit(!modal_edit);
        setIsSubmit(false);
        set_Id(_id);
        setIsLoading(true);
        getMenuById(_id)
            .then((res) => {
                setValues({
                    ...values,
                    menuName: res.data.data.menuName,
                    menuGroup: res.data.data.menuGroup,
                    menuUrl: res.data.data.menuUrl,
                    sequence: res.data.data.sequence,
                    isActive: res.data.data.isActive,
                    isParent: res.data.data.isParent || false,
                    parentMenu: res.data.data.parentMenu || null,
                    icon: res.data.data.icon || "",
                });
                setSelectedMenuGroup({
                    value: res.data.data.menuGroup._id,
                    label: res.data.data.menuGroup.menuGroupName,
                });

                // Set parent menu if exists
                if (res.data.data.parentMenu) {
                    fetchParentMenus(res.data.data.menuGroup._id).then(() => {
                        const parent = parentMenuList.find(
                            menu => menu._id === res.data.data.parentMenu
                        );
                        if (parent) {
                            setSelectedParentMenu({
                                value: parent._id,
                                label: parent.menuName,
                            });
                        }
                    });
                }
            })
            .catch((err) => {
                console.log(err);
                toast.error("Failed to fetch menu details");
            })
            .finally(() => {
                setIsLoading(false);
            });
    };

    const handleChange = (e) => {
        setValues({ ...values, [e.target.name]: e.target.value });
    };

    const handleCheck = (e) => {
        const { name, checked } = e.target;
        setValues({ ...values, [name]: checked });
    };

    const handleSubmitCancel = () => {
        setmodal_list(false);
        setValues(initialState);
        setSelectedMenuGroup(null);
        setSelectedParentMenu(null);
        setIsSubmit(false);
    };

    // Same reasoning as in MenuGroup.jsx: the sidebar caches menu data for up
    // to 30 minutes, so without this a save here wouldn't show up until that
    // cache expires. Clear it and re-fetch immediately after any change.
    const refreshSidebarMenus = () => {
        if (invalidateMenuCache) invalidateMenuCache();
        if (fetchMenus) fetchMenus(true);
    };

    const handleClick = (e) => {
        e.preventDefault();
        setFormErrors({});
        let errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);

        // If isParent is true, make sure we mark it accordingly
        const dataToSend = {
            ...values,
            menuGroup: selectedMenuGroup ? selectedMenuGroup.value : null,
            parentMenu: selectedParentMenu ? selectedParentMenu.value : null,
            isParent: values.isParent
        };

        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            createMenu(dataToSend)
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Menu Added Successfully!");
                        setmodal_list(!modal_list);
                        setValues(initialState);
                        setSelectedMenuGroup(null);
                        setSelectedParentMenu(null);
                        fetchDepartments();
                        refreshSidebarMenus();
                    }
                })
                .catch((error) => {
                    console.log("Error creating menu master:", error);
                    toast.error("Failed to add menu. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteMenu(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                toast.success("Menu Removed Successfully!");
                fetchDepartments();
                refreshSidebarMenus();
            })
            .catch((err) => {
                console.log(err);
                toast.error("Failed to remove menu. Please try again.");
            })
            .finally(() => {
                setIsDeleteLoading(false);
            });
    };

    const handleDeleteClose = (e) => {
        e.preventDefault();
        setmodal_delete(false);
    };

    const handleUpdateCancel = (e) => {
        setmodal_edit(false);
        setIsSubmit(false);
        setFormErrors({});
        setValues(initialState);
        setSelectedMenuGroup(null);
        setSelectedParentMenu(null);
    };

    const handleUpdate = (e) => {
        e.preventDefault();
        let erros = validate(values);
        setFormErrors(erros);
        setIsSubmit(true);

        if (Object.keys(erros).length === 0) {
            setIsLoading(true);
            const dataToSend = {
                ...values,
                menuGroup: selectedMenuGroup ? selectedMenuGroup.value : null,
                parentMenu: selectedParentMenu ? selectedParentMenu.value : null,
            };
            updateMenu(_id, dataToSend)
                .then((res) => {
                    setmodal_edit(!modal_edit);
                    setValues(initialState);
                    setSelectedMenuGroup(null);
                    setSelectedParentMenu(null);
                    fetchDepartments();
                    toast.success("Menu Updated Successfully!");
                    refreshSidebarMenus();
                })
                .catch((err) => {
                    console.log("Error updating menu master:", err);
                    toast.error("Failed to update menu. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const validate = (values) => {
        const errors = {};

        if (values.menuName === "") {
            errors.menuName = "Menu Name is required!";
        }

        if (selectedMenuGroup === null) {
            errors.menuGroup = "Menu Group is required!";
        }

        // Only require URL for non-parent menus
        if (!values.isParent && values.menuUrl === "") {
            errors.menuUrl = "Menu URL is required for non-parent menus!";
        }

        if (values.sequence === "") {
            errors.sequence = "Sequence is required!";
        }

        // Allow a menu to be both a parent and have a parent for multi-level hierarchy
        // We've removed the restriction that prevented an item from being both a parent and having a parent

        return errors;
    };

    const [loading, setLoading] = useState(false);
    const [totalRows, setTotalRows] = useState(0);
    const [perPage, setPerPage] = useState(100);
    const [pageNo, setPageNo] = useState(1);
    const [column, setcolumn] = useState();
    const [sortDirection, setsortDirection] = useState();

    const handleSort = (column, sortDirection) => {
        setcolumn(column.sortField);
        setsortDirection(sortDirection);
    };

    useEffect(() => {
        const timeout = setTimeout(() => {
            fetchDepartments();
        }, 500);
        return () => clearTimeout(timeout);
    }, [pageNo, perPage, column, sortDirection, query, filter]);

    const fetchDepartments = async () => {
        setLoading(true);
        let skip = (pageNo - 1) * perPage;
        if (skip < 0) {
            skip = 0;
        }

        try {
            const response = await searchMenus({
                skip: skip,
                per_page: perPage,
                sorton: column,
                sortdir: sortDirection,
                match: query,
                isActive: filter ? true : false,
            });

            if (response && response.data && response.data.data && response.data.data.length > 0) {
                let res = response.data.data[0];
                setTotalRows(res.count);
                setDepartments(res.data);
            } else {
                setDepartments([]);
            }
        } catch (error) {
            console.error("Error fetching menus:", error);
            setDepartments([]);
        }

        setLoading(false);
    };

    const handlePageChange = (page) => {
        setPageNo(page);
    };

    const handlePerRowsChange = async (newPerPage, page) => {
        setPerPage(newPerPage);
    };
    const handleFilter = (e) => {
        setPageNo(1);
        setFilter(e.target.checked);
    };
    const col = [
        {
            name: "Sr No",
            selector: (row, index) => index + 1,
            sortable: true,
            maxWidth: "60px",
        },
        {
            name: "Menu Name",
            selector: (row) => row.menuName,
            sortable: true,
            sortField: "menuName",
            minWidth: "150px",
        },
        {
            name: "Menu Group",
            cell: (row) => {
                const groupName = typeof row.menuGroup === 'object' && row.menuGroup !== null
                    ? row.menuGroup.menuGroupName
                    : row.menuGroup;
                const isDirectLink = typeof row.menuGroup === 'object' && row.menuGroup !== null
                    ? row.menuGroup.isLink
                    : false;
                return (
                    <div className="flex items-center gap-2">
                        <span>{groupName}</span>
                        {isDirectLink && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 whitespace-nowrap">
                                Direct Link
                            </span>
                        )}
                    </div>
                );
            },
            sortable: true,
            sortField: "menuGroup.menuGroupName",
            minWidth: "180px",
        },
        {
            name: "Menu URL",
            selector: (row) => row.menuUrl,
            minWidth: "170px",
        },
        {
            name: "Sequence",
            selector: (row) => row.sequence,
            sortable: true,
            sortField: "sequence",
            minWidth: "110px",
        },
        
        {
        name: "Action",
            cell: (row) => {
                return (
                    <div className="d-flex gap-2">
                        {currentPagePermissions.edit && (
                            <button
                                type="button"
                                className="btn btn-sm btn-soft-success btn-icon fs-14"
                                title="Edit"
                                onClick={() => handleTog_edit(row._id)}
                            >
                                <Pencil size={16} className="text-success" />
                            </button>
                        )}
                        {currentPagePermissions.delete && (
                            <button
                                type="button"
                                className="btn btn-sm btn-soft-danger btn-icon fs-14"
                                title="Remove"
                                onClick={() => tog_delete(row._id)}
                            >
                                <Trash2 size={16} className="text-danger" />
                            </button>
                        )}
                        {!currentPagePermissions.view && (
                            <span className="text-muted">No actions available</span>
                        )}
                    </div>
                );
            },
            sortable: false,
            minWidth: "180px",
        },
    ];

    document.title = `Menu Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    // Shared form body for both Add and Edit modals
    const renderMenuForm = () => (
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
            <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-700">
                    Menu Group <span className="text-red-500">*</span>
                </label>
                <Select
                    classNamePrefix="select"
                    placeholder="Select a menu group"
                    styles={selectStyles}
                    options={menuGroupList
                        .filter((menuGroup) => !menuGroup.isLink)
                        .map((menuGroup) => ({
                            value: menuGroup._id,
                            label: menuGroup.menuGroupName,
                        }))}
                    value={selectedMenuGroup}
                    onChange={(selectedOption) => {
                        setSelectedMenuGroup(selectedOption);
                    }}
                />
                {isSubmit && formErrors.menuGroup && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.menuGroup}</p>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-700">
                    Menu Name <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    name="menuName"
                    value={values.menuName}
                    onChange={handleChange}
                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
                />
                {isSubmit && formErrors.menuName && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.menuName}</p>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-700">
                    Menu URL {!values.isParent && <span className="text-red-500">*</span>}
                </label>
                <input
                    type="text"
                    name="menuUrl"
                    value={values.menuUrl}
                    onChange={handleChange}
                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
                />
                {isSubmit && formErrors.menuUrl && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.menuUrl}</p>
                )}
            </div>

            

            <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-700">
                    Sequence <span className="text-red-500">*</span>
                </label>
                <input
                    type="number"
                    name="sequence"
                    value={values.sequence}
                    onChange={handleChange}
                    min={1}
                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
                />
                {isSubmit && formErrors.sequence && (
                    <p className="mt-1 text-xs text-red-500">{formErrors.sequence}</p>
                )}
            </div>

            <IconPicker value={values.icon} onChange={(icon) => setValues({ ...values, icon })} />

            <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    name="isActive"
                    checked={values.isActive}
                    onChange={handleCheck}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">Is Active</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    name="isParent"
                    checked={values.isParent}
                    onChange={handleCheck}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">Is Parent Menu (can contain child menus)</span>
            </label>
            {isSubmit && formErrors.isParent && (
                <p className="text-xs text-red-500">{formErrors.isParent}</p>
            )}

            <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-700">
                    Parent Menu (optional)
                </label>
                <Select
                    classNamePrefix="select"
                    placeholder="Select a parent menu"
                    isClearable
                    styles={selectStyles}
                    options={parentMenuList.map((menu) => ({
                        value: menu._id,
                        label: menu.menuName, // This now shows the full path
                    }))}
                    value={selectedParentMenu}
                    onChange={(selectedOption) => {
                        setSelectedParentMenu(selectedOption);
                    }}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                    Select a parent menu to nest this menu under. The dropdown shows the full hierarchy.
                </p>
            </div>
        </form>
    );

    return (
        <React.Fragment>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="p-5 border-b border-slate-200">
                    <FormsHeader
                        formName="Menu Master"
                        filter={filter}
                        handleFilter={handleFilter}
                        tog_list={tog_list}
                        setQuery={setQuery}
                        showAddButton={currentPagePermissions.create}
                    />
                </div>

                <div className="p-2 sm:p-4">
                    <DataTable
                        columns={col}
                        data={departments}
                        progressPending={loading}
                        sortServer
                        onSort={(column, sortDirection) => {
                            handleSort(column, sortDirection);
                        }}
                        pagination
                        paginationServer
                        paginationComponentOptions={{ noRowsPerPage: true }}
                        paginationTotalRows={totalRows}
                        paginationPerPage={100}
                        onChangePage={handlePageChange}
                        highlightOnHover
                        pointerOnHover
                        customStyles={tableStyles}
                        noDataComponent={<div className="py-10 text-sm text-slate-400">No menus found.</div>}
                    />
                </div>
            </div>

            {/* Add Modal */}
            <Modal
                isOpen={modal_list}
                onClose={handleSubmitCancel}
                title="Add Menu Master"
                footer={
                    <FormsFooter
                        handleSubmit={handleClick}
                        handleSubmitCancel={handleSubmitCancel}
                        isLoading={isLoading}
                    />
                }
            >
                {renderMenuForm()}
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={modal_edit}
                onClose={handleUpdateCancel}
                title="Edit Menu Master"
                footer={
                    <FormUpdateFooter
                        handleUpdate={handleUpdate}
                        handleUpdateCancel={handleUpdateCancel}
                        isLoading={isLoading}
                    />
                }
            >
                {renderMenuForm()}
            </Modal>

            <DeleteModal
                show={modal_delete}
                handleDelete={handleDelete}
                toggle={handleDeleteClose}
                disabled={isDeleteLoading}
            />
        </React.Fragment>
    );
};

export default MenuMaster;