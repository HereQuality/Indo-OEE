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
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateProcesses } from "../hooks/useProcesses";
import {
    createProcess,
    deleteProcess,
    getProcessById,
    updateProcess,
    searchProcesses,
} from "../api/process.api";

const initialState = {
    processName: "",
    description: "",
    isActive: true,
};

const ProcessMaster = () => {
    const toast = useAlert();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);

    const [processes, setProcesses] = useState([]);
    const invalidateProcesses = useInvalidateProcesses();

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
            getProcessById(_id)
                .then((res) => {
                    const process = res.data.data;
                    setValues({
                        ...values,
                        processName: process.processName,
                        description: process.description || "",
                        isActive: process.isActive,
                    });
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to fetch process details");
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
        processName: values.processName,
        description: values.description,
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
            createProcess(buildPayload(values))
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Process Added Successfully!");
                        setmodal_list(!modal_list);
                        setValues(initialState);
                        fetchProcesses();
                        invalidateProcesses();
                    }
                })
                .catch((error) => {
                    console.log(error);
                    toast.error("Failed to add process. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteProcess(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                toast.success("Process Removed Successfully!");
                fetchProcesses();
                invalidateProcesses();
            })
            .catch((err) => {
                console.log(err);
                setmodal_delete(false);
                toast.error("Failed to delete process. Please try again.");
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
            updateProcess(_id, buildPayload(values))
                .then((res) => {
                    setmodal_edit(!modal_edit);
                    fetchProcesses();
                    invalidateProcesses();
                    toast.success("Process Updated Successfully!");
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to update process. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const validate = (values) => {
        const errors = {};

        if (!values.processName || !values.processName.trim()) {
            errors.processName = "Process Name is required!";
        } else if (values.processName.length > 100) {
            errors.processName = "Process Name must not exceed 100 characters";
        }

        if (values.description && values.description.length > 300) {
            errors.description = "Description must not exceed 300 characters";
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
            fetchProcesses();
        }, 500);
        return () => clearTimeout(timeout);
    }, [pageNo, perPage, column, sortDirection, query, filter]);

    const fetchProcesses = async () => {
        setLoading(true);
        let skip = (pageNo - 1) * perPage;
        if (skip < 0) {
            skip = 0;
        }

        try {
            const response = await searchProcesses({
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
                setProcesses(res.data);
            } else {
                setProcesses([]);
            }
        } catch (error) {
            console.error("Error fetching processes:", error);
            setProcesses([]);
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
            name: "Process Name",
            selector: (row) => row.processName,
            sortable: true,
            sortField: "processName",
            minWidth: "180px",
        },
        {
            name: "Description",
            selector: (row) => row.description,
            minWidth: "220px",
        },
        {
            name: "Status",
            selector: (row) => (row.isActive ? "Active" : "Inactive"),
            minWidth: "150px",
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

    document.title = `Process Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    const renderForm = () => (
        <>
            <div className="form-floating mb-3">
                <Input
                    type="text"
                    required
                    name="processName"
                    value={values.processName}
                    onChange={handleChange}
                    placeholder=" "
                    maxLength={100}
                    style={{ color: '#111827', fontWeight: '500' }}
                />
                <Label>
                    Process Name{" "}
                    <span className="text-danger">*</span>{" "}
                </Label>
                {isSubmit && (
                    <p className="text-danger">
                        {formErrors.processName}
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
                                        formName="Process"
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
                                                data={processes}
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
                    Add Process
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
                    Update Process
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

export default ProcessMaster;
