import React, { useState, useEffect, useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import {
    Button,
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
import Select, { components } from "react-select";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import ReferenceErrorModal from "../Components/Common/ReferenceErrorModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { toast } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateDepartments } from "../hooks/useDepartments";
import {
    createDepartment,
    deleteDepartment,
    getDepartmentById,
    updateDepartment,
    searchDepartments,
} from "../api/departments.api";

const initialState = {
    departmentName: "",
    departmentCode: "",
    remark: "",
    isActive: true,
};

const CustomOption = (props) => {
    return (
        <components.Option {...props}>
            <div className="form-check d-flex align-items-center m-0">
                <input
                    type="checkbox"
                    className="form-check-input mt-0 me-2"
                    checked={props.isSelected}
                    onChange={() => null}
                />
                <label className="form-check-label">{props.label}</label>
            </div>
        </components.Option>
    );
};

const Department = () => {
    const toast = useAlert();
    const navigate = useNavigate();
    const { roleSlug } = useParams();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);

    const [departments, setDepartments] = useState([]);
    const invalidateDepartments = useInvalidateDepartments();

    const [query, setQuery] = useState("");

    const [_id, set_Id] = useState("");
    const [remove_id, setRemove_id] = useState("");

    // Reference error modal states
    const [referenceModal, setReferenceModal] = useState(false);
    const [referenceData, setReferenceData] = useState(null);


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
        if (_id && typeof _id === 'string') {
            set_Id(_id);
            setIsLoading(true);
            getDepartmentById(_id)
                .then((res) => {
                    setValues({
                        ...values,
                        departmentName: res.data.data.departmentName,
                        departmentCode: res.data.data.departmentCode || "",
                        remark: res.data.data.remark || "",
                        isActive: res.data.data.isActive,
                    });
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to fetch department details");
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

    // Removing handleHodCheck

    const handleSubmitCancel = () => {
        setmodal_list(false);
        setValues(initialState);
        setIsSubmit(false);
    };

    const handleClick = (e) => {
        e.preventDefault();
        setFormErrors({});
        let errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);
        const dataToSend = {
            ...values,
        };
        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            createDepartment(dataToSend)
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Department Added Successfully!");
                        setmodal_list(!modal_list);
                        setValues(initialState);
                        fetchDepartments();
                        invalidateDepartments();
                    }
                })
                .catch((error) => {
                    console.log(error);
                    toast.error("Failed to add department. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteDepartment(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                toast.success("Department Removed Successfully!");
                fetchDepartments();
                invalidateDepartments();
            })
            .catch((err) => {
                console.log(err);
                setmodal_delete(false);

                if (err.response && err.response.status === 409) {
                    // Handle reference error
                    setReferenceData(err.response.data);
                    setReferenceModal(true);
                } else {
                    toast.error(
                        "Failed to delete department. Please try again."
                    );
                }
            })
            .finally(() => {
                setIsDeleteLoading(false);
            });
    };

    const handleDeleteClose = (e) => {
        e.preventDefault();
        setmodal_delete(false);
    };

    const handleReferenceModalClose = () => {
        setReferenceModal(false);
        setReferenceData(null);
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
            updateDepartment(_id, values)
                .then((res) => {
                    setmodal_edit(!modal_edit);
                    fetchDepartments();
                    invalidateDepartments();
                    toast.success("Department Updated Successfully!");
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to update department. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const validate = (values) => {
        const errors = {};

        if (!values.departmentName) {
            errors.departmentName = "Department Name is required!";
        } else if (values.departmentName.length > 15) {
            errors.departmentName = "Department Name must not exceed 15 characters";
        } else if (values.departmentCode.length > 10) {
            errors.departmentCode = "Department Code must not exceed 10 characters";
        }

        if (values.remark && values.remark.length > 50) {
            errors.remark = "Description must not exceed 50 characters";
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
            const response = await searchDepartments({
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
                setDepartments(res.data);
            } else {
                setDepartments([]);
            }
        } catch (error) {
            console.error("Error fetching departments:", error);
            setDepartments([]);
        } finally {
            setLoading(false);
        }
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
            maxWidth: "20px",
        },
        {
            name: "Department Name",
            selector: (row) => row.departmentName,
            sortable: true,
            sortField: "departmentName",
            minWidth: "130px",
        },
        {
            name: "Department Code",
            selector: (row) => row.departmentCode,
            sortable: true,
            sortField: "departmentCode",
            minWidth: "130px",
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

    document.title = `Department Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    return (
        <React.Fragment>
            <div className="page-content">
                <Container fluid>
                    <Row>
                        <Col lg={12}>
                            <Card>
                                <CardHeader>
                                    <FormsHeader
                                        formName="Department"
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
                                                data={departments}
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
                    Add Department
                </ModalHeader>
                <form noValidate>
                    <ModalBody>
                        <Row>
                            <Col md={6}>
                                <div className="form-floating mb-3">
                                    <Input
                                        type="text"
                                        required
                                        name="departmentName"
                                        value={values.departmentName}
                                        onChange={handleChange}
                                        placeholder=" "
                                        maxLength={15}
                                        style={{ color: '#111827', fontWeight: '500' }}
                                    />
                                    <Label>
                                        Department Name{" "}
                                        <span className="text-danger">*</span>{" "}
                                    </Label>
                                    {isSubmit && (
                                        <p className="text-danger">
                                            {formErrors.departmentName}
                                        </p>
                                    )}
                                </div>
                            </Col>
                            <Col md={6}>
                                <div className="form-floating mb-3">
                                    <Input
                                        type="text"
                                        name="departmentCode"
                                        value={values.departmentCode}
                                        onChange={handleChange}
                                        placeholder=" "
                                        maxLength={10}
                                        style={{ color: '#111827', fontWeight: '500' }}
                                    />
                                    <Label>
                                        Department Code
                                    </Label>
                                    {isSubmit && (
                                        <p className="text-danger">
                                            {formErrors.departmentCode}
                                        </p>
                                    )}
                                </div>
                            </Col>
                        </Row>
                        <div className="form-floating mb-3">
                            <textarea
                                className={`form-control ${isSubmit && formErrors.remark ? ' is-invalid' : ''}`}
                                style={{ height: "80px", color: '#111827', fontWeight: '500' }}
                                name="remark"
                                value={values.remark}
                                onChange={handleChange}
                                placeholder=" "
                                maxLength={50}
                            />
                            <Label>Description</Label>
                            {isSubmit && formErrors.remark && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.remark}</p>}
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
                    Update Department
                </ModalHeader>
                <form noValidate>
                    <ModalBody>
                        <Row>
                            <Col md={6}>
                                <div className="form-floating mb-3">
                                    <Input
                                        type="text"
                                        required
                                        name="departmentName"
                                        value={values.departmentName}
                                        onChange={handleChange}
                                        placeholder=" "
                                        maxLength={15}
                                        style={{ color: '#111827', fontWeight: '500' }}
                                    />
                                    <Label>
                                        Department Name{" "}
                                        <span className="text-danger">*</span>{" "}
                                    </Label>
                                    {isSubmit && (
                                        <p className="text-danger">
                                            {formErrors.departmentName}
                                        </p>
                                    )}
                                </div>
                            </Col>
                            <Col md={6}>
                                <div className="form-floating mb-3">
                                    <Input
                                        type="text"
                                        name="departmentCode"
                                        value={values.departmentCode}
                                        onChange={handleChange}
                                        placeholder=" "
                                        maxLength={10}
                                        style={{ color: '#111827', fontWeight: '500' }}
                                    />
                                    <Label>
                                        Department Code
                                    </Label>
                                    {isSubmit && (
                                        <p className="text-danger">
                                            {formErrors.departmentCode}
                                        </p>
                                    )}
                                </div>
                            </Col>
                        </Row>
                        <div className="form-floating mb-3">
                            <textarea
                                className={`form-control ${isSubmit && formErrors.remark ? ' is-invalid' : ''}`}
                                style={{ height: "80px", color: '#111827', fontWeight: '500' }}
                                name="remark"
                                value={values.remark}
                                onChange={handleChange}
                                placeholder=" "
                                maxLength={50}
                            />
                            <Label>Description</Label>
                            {isSubmit && formErrors.remark && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.remark}</p>}
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
                setmodal_delete={setmodal_delete}
                disabled={isDeleteLoading}
            />

            {referenceModal && (
                <ReferenceErrorModal
                    isOpen={referenceModal}
                    toggle={handleReferenceModalClose}
                    title="Cannot Delete Department"
                    referenceData={referenceData}
                />
            )}

        </React.Fragment>
    );
};

export default Department;
