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
import TimePicker from "../Components/Common/TimePicker";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateShifts } from "../hooks/useShifts";
import {
    createShift,
    deleteShift,
    getShiftById,
    updateShift,
    searchShifts,
} from "../api/shift.api";

const initialState = {
    shiftName: "",
    shiftOnTime: "",
    shiftOffTime: "",
    isActive: true,
};

const ShiftMaster = () => {
    const toast = useAlert();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);

    const [shifts, setShifts] = useState([]);
    const invalidateShifts = useInvalidateShifts();

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
            getShiftById(_id)
                .then((res) => {
                    const shift = res.data.data;
                    setValues({
                        ...values,
                        shiftName: shift.shiftName,
                        shiftOnTime: shift.shiftOnTime || "",
                        shiftOffTime: shift.shiftOffTime || "",
                        isActive: shift.isActive,
                    });
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to fetch shift details");
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

    const handleClick = (e) => {
        e.preventDefault();
        setFormErrors({});
        let errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);
        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            createShift(values)
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Shift Added Successfully!");
                        setmodal_list(!modal_list);
                        setValues(initialState);
                        fetchShifts();
                        invalidateShifts();
                    }
                })
                .catch((error) => {
                    console.log(error);
                    toast.error(error?.response?.data?.message || "Failed to add shift. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteShift(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                toast.success("Shift Removed Successfully!");
                fetchShifts();
                invalidateShifts();
            })
            .catch((err) => {
                console.log(err);
                setmodal_delete(false);
                toast.error("Failed to delete shift. Please try again.");
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
            updateShift(_id, values)
                .then((res) => {
                    setmodal_edit(!modal_edit);
                    fetchShifts();
                    invalidateShifts();
                    toast.success("Shift Updated Successfully!");
                })
                .catch((err) => {
                    console.log(err);
                    toast.error(err?.response?.data?.message || "Failed to update shift. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

    const validate = (values) => {
        const errors = {};

        if (!values.shiftName || !values.shiftName.trim()) {
            errors.shiftName = "Shift Name is required!";
        } else if (values.shiftName.length > 50) {
            errors.shiftName = "Shift Name must not exceed 50 characters";
        }

        if (!values.shiftOnTime || !TIME_RE.test(values.shiftOnTime)) {
            errors.shiftOnTime = "Shift On Time is required";
        }

        if (!values.shiftOffTime || !TIME_RE.test(values.shiftOffTime)) {
            errors.shiftOffTime = "Shift Off Time is required";
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
            fetchShifts();
        }, 500);
        return () => clearTimeout(timeout);
    }, [pageNo, perPage, column, sortDirection, query, filter]);

    const fetchShifts = async () => {
        setLoading(true);
        let skip = (pageNo - 1) * perPage;
        if (skip < 0) {
            skip = 0;
        }

        try {
            const response = await searchShifts({
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
                setShifts(res.data);
            } else {
                setShifts([]);
            }
        } catch (error) {
            console.error("Error fetching shifts:", error);
            setShifts([]);
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
            name: "Shift Name",
            selector: (row) => row.shiftName,
            sortable: true,
            sortField: "shiftName",
            minWidth: "160px",
        },
        {
            name: "Shift On Time",
            selector: (row) => row.shiftOnTime,
            minWidth: "130px",
        },
        {
            name: "Shift Off Time",
            selector: (row) => row.shiftOffTime,
            minWidth: "130px",
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

    document.title = `Shift Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    const renderForm = () => (
        <>
            <div className="form-floating mb-3">
                <Input
                    type="text"
                    required
                    name="shiftName"
                    value={values.shiftName}
                    onChange={handleChange}
                    placeholder=" "
                    maxLength={50}
                    style={{ color: '#111827', fontWeight: '500' }}
                />
                <Label>
                    Shift Name{" "}
                    <span className="text-danger">*</span>{" "}
                </Label>
                {isSubmit && (
                    <p className="text-danger">
                        {formErrors.shiftName}
                    </p>
                )}
            </div>

            <Row>
                <Col md={6}>
                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                            Shift On Time <span className="text-danger">*</span>
                        </label>
                        <TimePicker
                            name="shiftOnTime"
                            value={values.shiftOnTime}
                            onChange={handleChange}
                            hasError={isSubmit && !!formErrors.shiftOnTime}
                        />
                        {isSubmit && (
                            <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>
                                {formErrors.shiftOnTime}
                            </p>
                        )}
                    </div>
                </Col>
                <Col md={6}>
                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                            Shift Off Time <span className="text-danger">*</span>
                        </label>
                        <TimePicker
                            name="shiftOffTime"
                            value={values.shiftOffTime}
                            onChange={handleChange}
                            hasError={isSubmit && !!formErrors.shiftOffTime}
                        />
                        {isSubmit && (
                            <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>
                                {formErrors.shiftOffTime}
                            </p>
                        )}
                    </div>
                </Col>
            </Row>

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
                                        formName="Shift"
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
                                                data={shifts}
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
                    Add Shift
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
                    Update Shift
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

export default ShiftMaster;
