import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
    Card,
    CardBody,
    CardHeader,
    Col,
    Container,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Label,
    Input,
    Row,
} from "reactstrap";
import Select from "react-select";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useProcesses } from "../hooks/useProcesses";
import { useMachines } from "../hooks/useMachines";
import { useInvalidateItems } from "../hooks/useItems";
import {
    createItem,
    deleteItem,
    getItemById,
    updateItem,
    searchItems,
} from "../api/items.api";

const initialState = {
    itemName: "",
    itemCode: "",
    description: "",
    process: null,
    machine: null,
    cycleTimeMin: "",
    isActive: true,
};

const ItemMaster = () => {
    const toast = useAlert();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    const { data: processList = [] } = useProcesses();
    const processOptions = processList.map((p) => ({ value: p._id, label: p.processName }));

    const { data: machineList = [] } = useMachines();
    const machineOptions = machineList.map((m) => ({ value: m._id, label: m.machineName }));

    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);

    const [items, setItems] = useState([]);
    const invalidateItems = useInvalidateItems();

    const [query, setQuery] = useState("");

    const [_id, set_Id] = useState("");
    const [remove_id, setRemove_id] = useState("");

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
        if (_id && typeof _id === 'string') {
            set_Id(_id);
            setIsLoading(true);
            getItemById(_id)
                .then((res) => {
                    const item = res.data.data;
                    setValues({
                        ...values,
                        itemName: item.itemName,
                        itemCode: item.itemCode || "",
                        description: item.description || "",
                        process: item.process ? { value: item.process._id, label: item.process.processName } : null,
                        machine: item.machine ? { value: item.machine._id, label: item.machine.machineName } : null,
                        cycleTimeMin: item.cycleTimeMin ?? "",
                        isActive: item.isActive,
                    });
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to fetch item details");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleChange = (e) => {
        setValues({ ...values, [e.target.name]: e.target.value });
    };

    const handleCheck = (e) => {
        setValues({ ...values, isActive: e.target.checked });
    };

    const handleSubmitCancel = () => {
        setmodal_list(false);
        setValues(initialState);
        setIsSubmit(false);
    };

    const buildPayload = (values) => ({
        itemName: values.itemName,
        itemCode: values.itemCode,
        description: values.description,
        process: values.process?.value || "",
        machine: values.machine?.value || "",
        cycleTimeMin: values.cycleTimeMin,
        isActive: values.isActive,
    });

    const handleClick = (e) => {
        e.preventDefault();
        setFormErrors({});
        let errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);
        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            createItem(buildPayload(values))
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Item Added Successfully!");
                        setmodal_list(!modal_list);
                        setValues(initialState);
                        fetchItems();
                        invalidateItems();
                    }
                })
                .catch((error) => {
                    console.log(error);
                    toast.error(error?.response?.data?.message || "Failed to add item. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteItem(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                toast.success("Item Removed Successfully!");
                fetchItems();
                invalidateItems();
            })
            .catch((err) => {
                console.log(err);
                setmodal_delete(false);
                toast.error("Failed to delete item. Please try again.");
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
    };

    const handleUpdate = (e) => {
        e.preventDefault();
        let errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);

        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            updateItem(_id, buildPayload(values))
                .then((res) => {
                    setmodal_edit(!modal_edit);
                    fetchItems();
                    invalidateItems();
                    toast.success("Item Updated Successfully!");
                })
                .catch((err) => {
                    console.log(err);
                    toast.error(err?.response?.data?.message || "Failed to update item. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const validate = (values) => {
        const errors = {};

        if (!values.itemName || !values.itemName.trim()) {
            errors.itemName = "Item Name is required!";
        } else if (values.itemName.length > 100) {
            errors.itemName = "Item Name must not exceed 100 characters";
        }

        if (values.itemCode && values.itemCode.length > 20) {
            errors.itemCode = "Item Code must not exceed 20 characters";
        }

        if (values.description && values.description.length > 300) {
            errors.description = "Description must not exceed 300 characters";
        }

        if (!values.process) {
            errors.process = "Process is required!";
        }

        if (!values.machine) {
            errors.machine = "Machine is required!";
        }

        if (!values.cycleTimeMin || Number(values.cycleTimeMin) <= 0) {
            errors.cycleTimeMin = "Cycle Time must be greater than 0";
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
        const timeout = setTimeout(() => {
            fetchItems();
        }, 500);
        return () => clearTimeout(timeout);
    }, [pageNo, perPage, column, sortDirection, query, filter]);

    const fetchItems = async () => {
        setLoading(true);
        let skip = (pageNo - 1) * perPage;
        if (skip < 0) {
            skip = 0;
        }

        try {
            const response = await searchItems({
                skip: skip,
                per_page: perPage,
                sorton: column,
                sortdir: sortDirection,
                match: query,
                isActive: filter ? true : false,
            });

            if (response.data.data.length > 0) {
                let res = response.data.data[0];
                setTotalRows(res.count);
                setItems(res.data);
            } else {
                setItems([]);
            }
        } catch (error) {
            console.error("Error fetching items:", error);
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    const handlePageChange = (page) => {
        setPageNo(page);
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
            maxWidth: "20px",
        },
        {
            name: "Item Name",
            selector: (row) => row.itemName,
            sortable: true,
            sortField: "itemName",
            minWidth: "160px",
        },
        {
            name: "Item Code",
            selector: (row) => row.itemCode,
            sortable: true,
            sortField: "itemCode",
            minWidth: "120px",
        },
        {
            name: "Process",
            selector: (row) => row.process?.processName || "",
            minWidth: "150px",
        },
        {
            name: "Machine",
            selector: (row) => row.machine?.machineName || "",
            minWidth: "150px",
        },
        {
            name: "Cycle Time (min)",
            selector: (row) => row.cycleTimeMin,
            sortable: true,
            sortField: "cycleTimeMin",
            minWidth: "140px",
        },
        {
            name: "Status",
            selector: (row) => (row.isActive ? "Active" : "Inactive"),
            minWidth: "120px",
        },
        {
            name: "Action",
            cell: (row) => {
                return (
                    <React.Fragment>
                        <div className="d-flex gap-2">
                            {currentPagePermissions.edit && (
                                <button
                                    className="btn btn-sm btn-soft-success btn-icon fs-14"
                                    title="Edit"
                                    onClick={() => handleTog_edit(row._id)}
                                >
                                    <Pencil size={16} className="text-success" />
                                </button>
                            )}

                            {currentPagePermissions.delete && (
                                <button
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
                    </React.Fragment>
                );
            },
            sortable: false,
            minWidth: "160px",
        },
    ];

    document.title = `Item Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    const renderForm = () => (
        <>
            <Row>
                <Col md={6}>
                    <div className="form-floating mb-3">
                        <Input
                            type="text"
                            required
                            name="itemName"
                            value={values.itemName}
                            onChange={handleChange}
                            placeholder=" "
                            maxLength={100}
                            style={{ color: '#111827', fontWeight: '500' }}
                        />
                        <Label>
                            Item Name{" "}
                            <span className="text-danger">*</span>{" "}
                        </Label>
                        {isSubmit && (
                            <p className="text-danger">
                                {formErrors.itemName}
                            </p>
                        )}
                    </div>
                </Col>
                <Col md={6}>
                    <div className="form-floating mb-3">
                        <Input
                            type="text"
                            name="itemCode"
                            value={values.itemCode}
                            onChange={handleChange}
                            placeholder=" "
                            maxLength={20}
                            style={{ color: '#111827', fontWeight: '500' }}
                        />
                        <Label>
                            Item Code
                        </Label>
                        {isSubmit && (
                            <p className="text-danger">
                                {formErrors.itemCode}
                            </p>
                        )}
                    </div>
                </Col>
            </Row>

            <Row>
                <Col md={6}>
                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                            Process <span className="text-danger">*</span>
                        </label>
                        <Select
                            className="basic-single"
                            classNamePrefix="select"
                            menuPortalTarget={document.body}
                            styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            placeholder="Select Process…"
                            options={processOptions}
                            value={values.process}
                            onChange={(opt) => setValues({ ...values, process: opt })}
                        />
                        {isSubmit && formErrors.process && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.process}</p>}
                    </div>
                </Col>
                <Col md={6}>
                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                            Machine <span className="text-danger">*</span>
                        </label>
                        <Select
                            className="basic-single"
                            classNamePrefix="select"
                            menuPortalTarget={document.body}
                            styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            placeholder="Select Machine…"
                            options={machineOptions}
                            value={values.machine}
                            onChange={(opt) => setValues({ ...values, machine: opt })}
                        />
                        {isSubmit && formErrors.machine && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.machine}</p>}
                    </div>
                </Col>
            </Row>

            <div className="form-floating mb-3">
                <Input
                    type="number"
                    required
                    name="cycleTimeMin"
                    className="no-spinner"
                    value={values.cycleTimeMin}
                    onChange={handleChange}
                    onWheel={(e) => e.target.blur()}
                    placeholder=" "
                    min={0.01}
                    step={0.01}
                    style={{ color: '#111827', fontWeight: '500' }}
                />
                <Label>
                    Cycle Time (min){" "}
                    <span className="text-danger">*</span>{" "}
                </Label>
                {isSubmit && (
                    <p className="text-danger">
                        {formErrors.cycleTimeMin}
                    </p>
                )}
            </div>

            <div className="form-floating mb-3">
                <textarea
                    className={`form-control ${isSubmit && formErrors.description ? ' is-invalid' : ''}`}
                    style={{ height: "80px", color: '#111827', fontWeight: '500' }}
                    name="description"
                    value={values.description}
                    onChange={handleChange}
                    placeholder=" "
                    maxLength={300}
                />
                <Label>Description</Label>
                {isSubmit && formErrors.description && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.description}</p>}
            </div>

            <div className="mb-3">
                <Input
                    type="checkbox"
                    className="form-check-input"
                    name="isActive"
                    checked={values.isActive}
                    onChange={handleCheck}
                />
                <Label className="form-check-label ms-1">
                    Is Active
                </Label>
            </div>
        </>
    );

    return (
        <React.Fragment>
            <div className="page-content">
                <Container fluid>
                    <Row>
                        <Col lg={12}>
                            <Card>
                                <CardHeader>
                                    <FormsHeader
                                        formName="Item"
                                        filter={filter}
                                        handleFilter={handleFilter}
                                        tog_list={tog_list}
                                        setQuery={setQuery}
                                        showAddButton={
                                            currentPagePermissions.create
                                        }
                                    />
                                </CardHeader>

                                <CardBody>
                                    <div id="customerList">
                                        <div className="table-responsive table-card mt-1 mb-1 text-right">
                                            <DataTable
                                                columns={col}
                                                data={items}
                                                progressPending={loading}
                                                sortServer
                                                onSort={(
                                                    column,
                                                    sortDirection,
                                                    sortedRows
                                                ) => {
                                                    handleSort(
                                                        column,
                                                        sortDirection
                                                    );
                                                }}
                                                pagination
                                                paginationServer
                                                paginationComponentOptions={{ noRowsPerPage: true }}
                                                paginationTotalRows={totalRows}
                                                paginationPerPage={100}
                                                onChangePage={handlePageChange}
                                            />
                                        </div>
                                    </div>
                                </CardBody>
                            </Card>
                        </Col>
                    </Row>
                </Container>
            </div>

            {/* Add Modal */}
            <Modal
                isOpen={modal_list}
                toggle={() => {
                    tog_list();
                }}
                centered
                backdrop="static"
                keyboard={false}
            >
                <ModalHeader
                    className="p-3 border-bottom"
                    toggle={() => {
                        setmodal_list(false);
                        setIsSubmit(false);
                    }}
                >
                    Add Item
                </ModalHeader>
                <form noValidate>
                    <ModalBody>
                        {renderForm()}
                    </ModalBody>
                    <ModalFooter>
                        <FormsFooter
                            handleSubmit={handleClick}
                            handleSubmitCancel={handleSubmitCancel}
                            isLoading={isLoading}
                        />
                    </ModalFooter>
                </form>
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={modal_edit}
                toggle={() => {
                    handleTog_edit();
                }}
                centered
                backdrop="static"
                keyboard={false}
            >
                <ModalHeader
                    className="p-3 border-bottom"
                    toggle={() => {
                        setmodal_edit(false);
                        setIsSubmit(false);
                    }}
                >
                    Update Item
                </ModalHeader>
                <form noValidate>
                    <ModalBody>
                        {renderForm()}
                    </ModalBody>

                    <ModalFooter>
                        <FormUpdateFooter
                            handleUpdate={handleUpdate}
                            handleUpdateCancel={handleUpdateCancel}
                            isLoading={isLoading}
                        />
                    </ModalFooter>
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

export default ItemMaster;
