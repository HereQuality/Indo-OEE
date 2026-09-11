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
import TimePicker from "../Components/Common/TimePicker";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useProcesses } from "../hooks/useProcesses";
import { useShifts } from "../hooks/useShifts";
import { useInvalidateMachines } from "../hooks/useMachines";
import {
    createMachine,
    deleteMachine,
    getMachineById,
    updateMachine,
    searchMachines,
} from "../api/machines.api";

const initialState = {
    machineName: "",
    machineCode: "",
    description: "",
    machineOnTime: "",
    machineOffTime: "",
    processes: [],
    shifts: [],
    isActive: true,
};

const MachineMaster = () => {
    const toast = useAlert();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    const { data: processList = [] } = useProcesses();
    const processOptions = processList.map((p) => ({ value: p._id, label: p.processName }));

    const { data: shiftList = [] } = useShifts();
    const shiftOptions = shiftList.map((s) => ({ value: s._id, label: s.shiftName }));

    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);

    const [machines, setMachines] = useState([]);
    const invalidateMachines = useInvalidateMachines();

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
            getMachineById(_id)
                .then((res) => {
                    const machine = res.data.data;
                    setValues({
                        ...values,
                        machineName: machine.machineName,
                        machineCode: machine.machineCode || "",
                        description: machine.description || "",
                        machineOnTime: machine.machineOnTime || "",
                        machineOffTime: machine.machineOffTime || "",
                        processes: machine.processes?.map((p) => ({ value: p._id, label: p.processName })) || [],
                        shifts: machine.shifts?.map((s) => ({ value: s._id, label: s.shiftName })) || [],
                        isActive: machine.isActive,
                    });
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to fetch machine details");
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
        machineName: values.machineName,
        machineCode: values.machineCode,
        description: values.description,
        machineOnTime: values.machineOnTime,
        machineOffTime: values.machineOffTime,
        isActive: values.isActive,
        processes: values.processes.map((p) => p.value),
        shifts: values.shifts.map((s) => s.value),
    });

    const handleClick = (e) => {
        e.preventDefault();
        setFormErrors({});
        let errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);
        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            createMachine(buildPayload(values))
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Machine Added Successfully!");
                        setmodal_list(!modal_list);
                        setValues(initialState);
                        fetchMachines();
                        invalidateMachines();
                    }
                })
                .catch((error) => {
                    console.log(error);
                    toast.error("Failed to add machine. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteMachine(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                toast.success("Machine Removed Successfully!");
                fetchMachines();
                invalidateMachines();
            })
            .catch((err) => {
                console.log(err);
                setmodal_delete(false);
                toast.error("Failed to delete machine. Please try again.");
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
            updateMachine(_id, buildPayload(values))
                .then((res) => {
                    setmodal_edit(!modal_edit);
                    fetchMachines();
                    invalidateMachines();
                    toast.success("Machine Updated Successfully!");
                })
                .catch((err) => {
                    console.log(err);
                    toast.error("Failed to update machine. Please try again.");
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    };

    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

    const validate = (values) => {
        const errors = {};

        if (!values.machineName || !values.machineName.trim()) {
            errors.machineName = "Machine Name is required!";
        } else if (values.machineName.length > 100) {
            errors.machineName = "Machine Name must not exceed 100 characters";
        }

        if (values.machineCode && values.machineCode.length > 20) {
            errors.machineCode = "Machine Code must not exceed 20 characters";
        }

        if (values.description && values.description.length > 300) {
            errors.description = "Description must not exceed 300 characters";
        }

        if (!values.machineOnTime || !TIME_RE.test(values.machineOnTime)) {
            errors.machineOnTime = "Shift Time Start is required";
        }

        if (!values.machineOffTime || !TIME_RE.test(values.machineOffTime)) {
            errors.machineOffTime = "Shift Time End is required";
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
            fetchMachines();
        }, 500);
        return () => clearTimeout(timeout);
    }, [pageNo, perPage, column, sortDirection, query, filter]);

    const fetchMachines = async () => {
        setLoading(true);
        let skip = (pageNo - 1) * perPage;
        if (skip < 0) {
            skip = 0;
        }

        try {
            const response = await searchMachines({
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
                setMachines(res.data);
            } else {
                setMachines([]);
            }
        } catch (error) {
            console.error("Error fetching machines:", error);
            setMachines([]);
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
            name: "Machine Name",
            selector: (row) => row.machineName,
            sortable: true,
            sortField: "machineName",
            minWidth: "160px",
        },
        {
            name: "Machine Code",
            selector: (row) => row.machineCode,
            sortable: true,
            sortField: "machineCode",
            minWidth: "130px",
        },
        {
            name: "Shift Time",
            selector: (row) => `${row.machineOnTime || "--"} - ${row.machineOffTime || "--"}`,
            minWidth: "140px",
        },
        {
            name: "Processes",
            selector: (row) => row.processes?.map((p) => p.processName || p.name).join(", ") || "",
            minWidth: "180px",
        },
        {
            name: "Shifts",
            selector: (row) => row.shifts?.map((s) => s.shiftName).join(", ") || "",
            minWidth: "150px",
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

    document.title = `Machine Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    const renderForm = () => (
        <>
            <Row>
                <Col md={6}>
                    <div className="form-floating mb-3">
                        <Input
                            type="text"
                            required
                            name="machineName"
                            value={values.machineName}
                            onChange={handleChange}
                            placeholder=" "
                            maxLength={100}
                            style={{ color: '#111827', fontWeight: '500' }}
                        />
                        <Label>
                            Machine Name{" "}
                            <span className="text-danger">*</span>{" "}
                        </Label>
                        {isSubmit && (
                            <p className="text-danger">
                                {formErrors.machineName}
                            </p>
                        )}
                    </div>
                </Col>
                <Col md={6}>
                    <div className="form-floating mb-3">
                        <Input
                            type="text"
                            name="machineCode"
                            value={values.machineCode}
                            onChange={handleChange}
                            placeholder=" "
                            maxLength={20}
                            style={{ color: '#111827', fontWeight: '500' }}
                        />
                        <Label>
                            Machine Code
                        </Label>
                        {isSubmit && (
                            <p className="text-danger">
                                {formErrors.machineCode}
                            </p>
                        )}
                    </div>
                </Col>
            </Row>

            <Row>
                <Col md={6}>
                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                            Shift Time Start <span className="text-danger">*</span>
                        </label>
                        <TimePicker
                            name="machineOnTime"
                            value={values.machineOnTime}
                            onChange={handleChange}
                            hasError={isSubmit && !!formErrors.machineOnTime}
                        />
                        {isSubmit && (
                            <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>
                                {formErrors.machineOnTime}
                            </p>
                        )}
                    </div>
                </Col>
                <Col md={6}>
                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                            Shift Time End <span className="text-danger">*</span>
                        </label>
                        <TimePicker
                            name="machineOffTime"
                            value={values.machineOffTime}
                            onChange={handleChange}
                            hasError={isSubmit && !!formErrors.machineOffTime}
                        />
                        {isSubmit && (
                            <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>
                                {formErrors.machineOffTime}
                            </p>
                        )}
                    </div>
                </Col>
            </Row>

            <div className="mb-3">
                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                    Processes
                </label>
                <Select
                    className="basic-multi-select"
                    classNamePrefix="select"
                    menuPortalTarget={document.body}
                    styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                    placeholder="Select Process(es)…"
                    isMulti
                    options={processOptions}
                    value={values.processes}
                    onChange={(opt) => setValues({ ...values, processes: opt || [] })}
                />
            </div>

            <div className="mb-3">
                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                    Shifts
                </label>
                <Select
                    className="basic-multi-select"
                    classNamePrefix="select"
                    menuPortalTarget={document.body}
                    styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                    placeholder="Select Shift(s)… (this machine runs on more than one shift if needed)"
                    isMulti
                    options={shiftOptions}
                    value={values.shifts}
                    onChange={(opt) => setValues({ ...values, shifts: opt || [] })}
                />
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
                                        formName="Machine"
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
                                                data={machines}
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
                    Add Machine
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
                    Update Machine
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

export default MachineMaster;
