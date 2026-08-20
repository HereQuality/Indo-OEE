import React, { useContext, useState, useEffect } from "react";
import { Pencil, Trash2 } from "lucide-react";
import DataTable from "react-data-table-component";
import Modal from "../Components/Common/Modal";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { createMenuGroup, deleteMenuGroup, getMenuGroupById, updateMenuGroup, searchMenuGroups } from "../api/menus.api";
import { MenuContext } from "../context/MenuContext";
import { useAlert } from "../context/AlertContext";
import IconPicker from "../Components/Common/IconPicker";

const initialState = {
  menuGroupName: "",
  sequence: "",
  isActive: false,
  isLink: false,
  menuUrl: "",
  portal: "Both",
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

const MenuGroup = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true }, invalidateMenuCache, fetchMenus } = useContext(MenuContext) || {};
  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [departments, setDepartments] = useState([]);

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
    getMenuGroupById(_id)
      .then((res) => {
        setValues({
          ...values,
          menuGroupName: res.data.data.menuGroupName,
          sequence: res.data.data.sequence,
          isActive: res.data.data.isActive,
          isLink: res.data.data.isLink,
          menuUrl: res.data.data.menuUrl,
          portal: res.data.data.portal || "Both",
          icon: res.data.data.icon || "",
        });
      })
      .catch((err) => {
        console.log(err);
        toast.error("Failed to fetch menu group details");
      }).finally(() => {
        setIsLoading(false);
      });
  };

  const handleChange = (e) => {
    setValues({ ...values, [e.target.name]: e.target.value });
  };

  const handleCheck = (e) => {
    setValues({ ...values, [e.target.name]: e.target.checked });
  };

  const handleSubmitCancel = () => {
    setmodal_list(false);
    setValues(initialState);
    setIsSubmit(false);
  };

  // Menu Groups changes affect the live sidebar, which caches its data for
  // up to 30 minutes for performance. Without this, a save here wouldn't be
  // reflected until the cache expires (or a hard refresh happens to land
  // after it does) — clearing it and re-fetching now makes the sidebar
  // update immediately in this same session.
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
    const dataToSend = {
      ...values,
    }
    if (
      Object.keys(errors).length === 0
    ) {
      setIsLoading(true);
      createMenuGroup(dataToSend)
        .then((res) => {
          if (res.data.isOk) {
            toast.success("Menu Group Added Successfully!");
            setmodal_list(!modal_list);
            setValues(initialState);
            fetchDepartments();
            refreshSidebarMenus();
          }
        })
        .catch((error) => {
          console.log("Error creating menu group:", error);
          toast.error("Failed to add menu group. Please try again.");
        }).finally(() => {
          setIsLoading(false);
        });
    }
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteMenuGroup(remove_id)
      .then((res) => {
        setmodal_delete(!modal_delete);
        toast.success("Menu Group Removed Successfully!");
        fetchDepartments();
        refreshSidebarMenus();
      })
      .catch((err) => {
        console.log(err);
        toast.error("Failed to remove menu group. Please try again.");
      }).finally(() => {
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
  };

  const handleUpdate = (e) => {
    e.preventDefault();
    let erros = validate(values);
    setFormErrors(erros);
    setIsSubmit(true);

    if (Object.keys(erros).length === 0) {
      setIsLoading(true);
      updateMenuGroup(_id, values)
        .then((res) => {
          setmodal_edit(!modal_edit);
          fetchDepartments();
          toast.success("Menu Group Updated Successfully!");
          refreshSidebarMenus();
        })
        .catch((err) => {
          console.log(err);
          toast.error("Failed to update menu group. Please try again.");
        }).finally(() => {
          setIsLoading(false);
        });
    }
  };

  const validate = (values) => {
    const errors = {};

    if (values.menuGroupName === "") {
      errors.menuGroupName = "Menu Group Name is required!";
    }

    if (values.sequence === "") {
      errors.sequence = "Sequence is required!";
    }

    if (values.isLink && values.menuUrl === "") {
      errors.menuUrl = "Menu URL is required for direct link menu groups!";
    }

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
    fetchDepartments();
  }, [pageNo, perPage, column, sortDirection, query, filter]);

  const fetchDepartments = async () => {
    setLoading(true);
    let skip = (pageNo - 1) * perPage;
    if (skip < 0) {
      skip = 0;
    }

    try {
      const response = await searchMenuGroups({
        skip: skip,
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: filter ? true : false,
      });

      if (response && response.data && response.data.data && response.data.data.length > 0) {
        let res = response.data.data[0];
        setLoading(false);
        setTotalRows(res.count);
        setDepartments(res.data);
      } else {
        setDepartments([]);
      }
    } catch (error) {
      console.error("Error fetching menu groups:", error);
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
    setPageNo(1)
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
      name: "Menu Group Name",
      selector: (row) => row.menuGroupName,
      sortable: true,
      sortField: "menuGroupName",
      minWidth: "160px",
    },
    {
      name: "Sequence",
      selector: (row) => row.sequence,
      sortable: true,
      sortField: "sequence",
      minWidth: "110px",
    },
    {
      name: "Portal",
      selector: (row) => (
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
            row.portal === "SuperAdmin"
              ? "bg-primary-50 text-primary-700"
              : row.portal === "Employee"
              ? "bg-secondary-50 text-secondary-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {row.portal || "Both"}
        </span>
      ),
      minWidth: "130px",
    },
    {
      name: "Status",
      selector: (row) => (
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
            row.isActive ? "bg-success-50 text-success-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {row.isActive ? "Active" : "Inactive"}
        </span>
      ),
      minWidth: "130px",
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

  document.title = `Menu Group Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-5 border-b border-slate-200">
          <FormsHeader
            formName="Menu Group"
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
            noDataComponent={<div className="py-10 text-sm text-slate-400">No menu groups found.</div>}
          />
        </div>
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={modal_list}
        onClose={handleSubmitCancel}
        title="Add Menu Group"
        footer={
          <FormsFooter
            handleSubmit={handleClick}
            handleSubmitCancel={handleSubmitCancel}
            isLoading={isLoading}
          />
        }
      >
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-700">
              Menu Group Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="menuGroupName"
              value={values.menuGroupName}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
            />
            {isSubmit && formErrors.menuGroupName && (
              <p className="mt-1 text-xs text-red-500">{formErrors.menuGroupName}</p>
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

          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-700">
              Portal <span className="text-red-500">*</span>
            </label>
            <select
              name="portal"
              value={values.portal}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
            >
              <option value="SuperAdmin">SuperAdmin only</option>
              <option value="Employee">Employee only</option>
              <option value="Both">Both portals</option>
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              Controls whether this group shows up in the SuperAdmin sidebar, the Employee sidebar, or both.
            </p>
          </div>

          

          <IconPicker value={values.icon} onChange={(icon) => setValues({ ...values, icon })} />

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              name="isLink"
              checked={values.isLink}
              onChange={handleCheck}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-700">Is Direct Link (no submenus)</span>
          </label>

          {values.isLink && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-700">
                Menu URL <span className="text-red-500">*</span>
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
          )}

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
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={modal_edit}
        onClose={handleUpdateCancel}
        title="Edit Menu Group"
        footer={
          <FormUpdateFooter
            handleUpdate={handleUpdate}
            handleUpdateCancel={handleUpdateCancel}
            isLoading={isLoading}
          />
        }
      >
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-700">
              Menu Group Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="menuGroupName"
              value={values.menuGroupName}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
            />
            {isSubmit && formErrors.menuGroupName && (
              <p className="mt-1 text-xs text-red-500">{formErrors.menuGroupName}</p>
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

          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-700">
              Portal <span className="text-red-500">*</span>
            </label>
            <select
              name="portal"
              value={values.portal}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-sm transition-all text-slate-800"
            >
              <option value="SuperAdmin">SuperAdmin only</option>
              <option value="Employee">Employee only</option>
              <option value="Both">Both portals</option>
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              Controls whether this group shows up in the SuperAdmin sidebar, the Employee sidebar, or both.
            </p>
          </div>

          

          <IconPicker value={values.icon} onChange={(icon) => setValues({ ...values, icon })} />

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              name="isLink"
              checked={values.isLink}
              onChange={handleCheck}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-700">Is Direct Link (no submenus)</span>
          </label>

          {values.isLink && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-700">
                Menu URL <span className="text-red-500">*</span>
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
          )}

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
        </form>
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

export default MenuGroup;