import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { Pencil, Trash2 } from "lucide-react";
import ConfirmAlert from "../Components/Common/ConfirmAlert";
import {
    Input,
    Label,
    Card,
    CardBody,
    CardHeader,
    Col,
    Form,
    Container,
    Row,
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Button,
} from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import { AuthContext } from "../context/AuthContext";
import Select from "react-select";
import CreatableSelect from 'react-select/creatable';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useAlert } from "../context/AlertContext";
import { createEmployee, deleteEmployee, getEmployeeById, updateEmployee, searchEmployees, resetEmployeePassword } from "../api/employees.api";
import { MenuContext } from "../context/MenuContext";
import { useRoles } from "../hooks/useRoles";
import { useDepartments } from "../hooks/useDepartments";
import { useTeams, useInvalidateTeams } from "../hooks/useTeams";
import { useInvalidateEmployees } from "../hooks/useEmployees";
import { checkUsernameAvailability } from "../api/auth.api";
import { createRole } from "../api/roles.api";
import { createDepartment } from "../api/departments.api";
import { createTeam } from "../api/teams.api";
import { getSkills } from "../api/skills.api";
import { useInvalidateRoles } from "../hooks/useRoles";
import { useInvalidateDepartments } from "../hooks/useDepartments";

const Employee = () => {
    const toast = useAlert();
    const { adminData } = useContext(AuthContext);
    const invalidateEmployees = useInvalidateEmployees();
    // Basic states
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleteLoading, setIsDeleteLoading] = useState(false);
    const [formErrors, setFormErrors] = useState({});
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);
    const [_id, set_Id] = useState("");

    const initialState = {
        employeeCode: "",
        employeeName: "",
        username: "",
        departmentIds: [],
        teamIds: [],
        roleId: "",
        skills: [],
        joiningDate: "",
        emailOffice: "",
        mobileNumber: "",
        address: "",
        remark: "",
        password: "",
        isActive: true,
    };
    
    // New states for File upload
    const [profilePic, setProfilePic] = useState(null);
    const [profilePicPreview, setProfilePicPreview] = useState(null);

    // Username availability check
    const [usernameStatus, setUsernameStatus] = useState('idle'); // idle|checking|available|taken|short
    const usernameTimerRef = useRef(null);
    const [editingEmployeeId, setEditingEmployeeId] = useState(null); // for uniqueness exclusion

    // Remove file-related states - no longer needed

    const [remove_id, setRemove_id] = useState("");
    const [query, setQuery] = useState("");
    const [values, setValues] = useState(initialState);
    const [initialFormData, setInitialFormData] = useState(null);

    // Password reset states
    const [showResetPassword, setShowResetPassword] = useState(false);
    const [resetPasswordData, setResetPasswordData] = useState({
        newPassword: "",
        confirmPassword: "",
    });
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordResetError, setPasswordResetError] = useState("");

    const [loading, setLoading] = useState(false);
    const [totalRows, setTotalRows] = useState(0);
    const [perPage, setPerPage] = useState(100);
    const [pageNo, setPageNo] = useState(1);
    const [column, setcolumn] = useState();
    const [sortDirection, setsortDirection] = useState();

    const [showForm, setShowForm] = useState(false);
    const [updateForm, setUpdateForm] = useState(false);
    const [data, setData] = useState([]);

    const { data: departmentList = [] } = useDepartments({
        onError: () => toast.error("Failed to load departments"),
    });
    const { data: teamList = [] } = useTeams({
        onError: () => toast.error("Failed to load teams"),
    });
    const [selectedDepartment, setSelectedDepartment] = useState(null);

    const { data: roleList = [] } = useRoles({
        onError: () => toast.error("Failed to load roles"),
    });
    const [selectedRole, setSelectedRole] = useState(null);
    const invalidateRoles = useInvalidateRoles();
    const invalidateDepartments = useInvalidateDepartments();

    const [dbSkills, setDbSkills] = useState([]);
    useEffect(() => {
        getSkills({ isActive: true }).then(res => {
            if (res.data?.isOk) {
                setDbSkills(res.data.data.map(s => ({ value: s.skillName, label: s.skillName })));
            }
        }).catch(err => console.error(err));
    }, []);

    // Quick-add Role modal state
    const [showAddRoleModal, setShowAddRoleModal] = useState(false);
    const [newRoleData, setNewRoleData] = useState({ roleName: "", roleCode: "", remark: "", isActive: true });
    const [addRoleLoading, setAddRoleLoading] = useState(false);

    // Quick-add Department modal state
    const [showAddDeptModal, setShowAddDeptModal] = useState(false);
    const [newDeptData, setNewDeptData] = useState({ departmentName: "", departmentCode: "", remark: "", isActive: true, hodIds: [] });
    const [addDeptLoading, setAddDeptLoading] = useState(false);

    // Quick-add Team modal state
    const [showAddTeamModal, setShowAddTeamModal] = useState(false);
    const [newTeamData, setNewTeamData] = useState({ teamName: "", description: "", teamLeadId: null, memberIds: [], remark: "", isActive: true });
    const [addTeamLoading, setAddTeamLoading] = useState(false);


    const invalidateTeams = useInvalidateTeams();

    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    // Block/Unblock confirm state
    const [blockAlert, setBlockAlert] = useState({ open: false, row: null });

    const columns = [
        {
            name: "Sr No",
            selector: (row, index) => index + 1,
            sortable: true,
            maxWidth: "20px",
        },
        {
            name: "Employee",
            selector: (row) => (
                <div className="d-flex align-items-center gap-2">
                    {row.profilePic ? (
                        <img src={row.profilePic} alt="profile" style={{width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover'}} />
                    ) : (
                        <div className="bg-primary text-white d-flex align-items-center justify-content-center shadow-sm" style={{width: '32px', height: '32px', borderRadius: '50%', fontSize: '12px', fontWeight: 'bold'}}>
                            {row.employeeName?.substring(0, 2).toUpperCase()}
                        </div>
                    )}
                    <div className="text-start">
                        <p className="mb-0 fw-medium text-wrap">{row.employeeName}</p>
                        {row.username && <p className="mb-0 text-muted small text-wrap">@{row.username}</p>}
                    </div>
                </div>
            ),
            maxWidth: "250px",
        },
        {
            name: "Department",
            selector: (row) => <p className="text-wrap">{row.departmentIds?.map(d => d.departmentName).join(', ') || ''}</p>,
            sortable: false,
            minWidth: "150px",
        },
        {
            name: "Teams",
            selector: (row) => <p className="text-wrap">{row.teamIds?.map(t => t.teamName).join(', ') || ''}</p>,
            sortable: false,
            minWidth: "150px",
        },
        {
            name: "Email",
            selector: (row) => <p className="text-wrap">{row.emailOffice || '—'}</p>,
            sortable: true,
            maxWidth: "250px",
        },
        {
            name: "Role",
            selector: (row) => (
                <span className="fw-bold" style={{ color: "#3b82f6", fontSize: "13.5px" }}>
                    {row.roleId?.roleName || row.role?.roleName || '—'}
                </span>
            ),
            sortable: false,
            maxWidth: "180px",
        },
        {
            name: "Action",
            cell: (row) => {
                return (
                    <div className="d-flex gap-2 align-items-center">
                        {currentPagePermissions.edit && <button
                            className="btn btn-sm btn-soft-success btn-icon fs-14"
                            title="Edit"
                            onClick={() => handleTog_edit(row._id)}
                        >
                            <Pencil size={16} className="text-success" />
                        </button>}
                        {currentPagePermissions.edit && (
                            <button
                                title={row.isBlocked ? "Unblock Employee" : "Block Employee"}
                                onClick={() => setBlockAlert({ open: true, row })}
                                style={{
                                    background: !row.isBlocked ? "transparent" : "#dc2626",
                                    border: "2px solid #dc2626",
                                    borderRadius: "8px",
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                {!row.isBlocked ? (
                                    /* Outline shield — unblocked state */
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                    </svg>
                                ) : (
                                    /* Filled shield — blocked state */
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                    </svg>
                                )}
                            </button>
                        )}
                        {currentPagePermissions.delete && <button
                            className="btn btn-sm btn-soft-danger btn-icon fs-14"
                            title="Remove"
                            onClick={() => tog_delete(row._id)}
                        >
                            <Trash2 size={16} className="text-danger" />
                        </button>}
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

    const fetchEmployeeMaster = useCallback(async () => {
        setLoading(true);
        let skip = (pageNo - 1) * perPage;
        if (skip < 0) skip = 0;
        try {
            const response = await searchEmployees({
                skip: skip,
                per_page: perPage,
                sorton: column,
                sortdir: sortDirection,
                match: query,
                isActive: filter ? true : false,
                branchId: adminData?.branchId ? adminData.branchId._id : null,
            });
            if (response && response.data && response.data.data && response.data.data.length > 0) {
                let res = response.data.data[0];
                setData(res.data);
                setTotalRows(res.count);
            } else {
                setData([]);
            }
        } catch (err) {
            console.log(err);
            setData([]);
        }
        setLoading(false);
    }, [pageNo, perPage, column, sortDirection, query, filter, adminData?.branchId]);

    useEffect(() => {
        fetchEmployeeMaster();
    }, [fetchEmployeeMaster]);

    const validate = (values) => {
        const errors = {};
        if (!values.employeeName) errors.employeeName = "Name is required";
        if (!values.username) errors.username = "Username is required";
        // Email validation (optional field)
        if (values.emailOffice) {
            if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.emailOffice))
                errors.emailOffice = "Invalid email address (e.g. user@example.com)";
        }
        // Only require password in add mode
        if (!values.password && !updateForm) errors.password = "Password is required";
        if (values.mobileNumber) {
            if (!/^[0-9]{10}$/.test(values.mobileNumber))
                errors.mobileNumber = "Phone number must be exactly 10 digits";
        }
        if (!selectedRole) errors.role = "Role is required";
        if (values.username && values.username.length < 3) errors.username = "Username must be at least 3 characters";
        if (usernameStatus === 'taken') errors.username = "Username already taken";
        if (values.remark && values.remark.length > 200)
            errors.remark = "Remark must not exceed 200 characters";
        return errors;
    };

    // Live username availability check
    const handleUsernameChange = useCallback((e) => {
        const val = e.target.value;
        setValues((prev) => ({ ...prev, username: val }));
        if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
        if (!val || val.length < 3) { setUsernameStatus(val ? 'short' : 'idle'); return; }
        setUsernameStatus('checking');
        usernameTimerRef.current = setTimeout(async () => {
            const available = await checkUsernameAvailability(val);
            // If editing and the username belongs to this employee, it's fine
            setUsernameStatus(available ? 'available' : 'taken');
        }, 400);
    }, [editingEmployeeId]);

    const handleClick = (e) => {
        e.preventDefault();
        const errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);
        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            const formData = new FormData();
            formData.append("employeeCode", values.employeeCode || "");
            formData.append("employeeName", values.employeeName);
            if (values.username) formData.append("username", values.username);
            formData.append("roleId", selectedRole?.value || "");
            formData.append("departmentIds", JSON.stringify(values.departmentIds.map(d => d.value)));
            formData.append("teamIds", JSON.stringify(values.teamIds.map(t => t.value)));
            formData.append("skills", JSON.stringify(values.skills.map(s => s.value)));
            if (values.joiningDate) formData.append("joiningDate", values.joiningDate);
            if (values.emailOffice) formData.append("emailOffice", values.emailOffice);
            if (values.mobileNumber) formData.append("mobileNumber", values.mobileNumber);
            if (values.address) formData.append("address", values.address);
            if (values.remark) formData.append("remark", values.remark);
            if (values.password) formData.append("password", values.password);
            formData.append("isActive", values.isActive);
            if (profilePic) {
                formData.append("profilePic", profilePic);
            }

            createEmployee(formData)
                .then((res) => {
                    if (res.data?.isOk) {
                        setShowForm(false);
                        setValues(initialState);
                        setIsSubmit(false);
                        setFormErrors({});
                        setSelectedRole(null);
                        setProfilePic(null);
                        setProfilePicPreview(null);
                        setUsernameStatus('idle');
                        fetchEmployeeMaster();
                        invalidateEmployees();
                        toast.success("Employee Added Successfully");
                    } else {
                        toast.error(res.data?.message || "Failed to add employee.");
                    }
                })
                .catch((err) => {
                    toast.error(err.response?.data?.message || "Failed to add employee. Please try again.");
                })
                .finally(() => setIsLoading(false));
        }
    };

    const handleUpdate = (e) => {
        e.preventDefault();
        const errors = validate(values);
        setFormErrors(errors);
        setIsSubmit(true);
        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            const formData = new FormData();
            formData.append("employeeCode", values.employeeCode || "");
            formData.append("employeeName", values.employeeName);
            if (values.username) formData.append("username", values.username);
            formData.append("roleId", selectedRole?.value || "");
            formData.append("departmentIds", JSON.stringify(values.departmentIds.map(d => d.value)));
            formData.append("teamIds", JSON.stringify(values.teamIds.map(t => t.value)));
            formData.append("skills", JSON.stringify(values.skills.map(s => s.value)));
            if (values.joiningDate) formData.append("joiningDate", values.joiningDate);
            if (values.emailOffice) formData.append("emailOffice", values.emailOffice);
            if (values.mobileNumber) formData.append("mobileNumber", values.mobileNumber);
            if (values.address) formData.append("address", values.address);
            if (values.remark) formData.append("remark", values.remark);
            formData.append("isActive", values.isActive);
            if (profilePic) {
                formData.append("profilePic", profilePic);
            }

            updateEmployee(_id, formData)
                .then((res) => {
                    if (res.data.isOk) {
                        toast.success("Employee Updated Successfully");
                        setUpdateForm(false);
                        setShowForm(false);
                        setValues(initialState);
                        setIsSubmit(false);
                        setFormErrors({});
                        setSelectedRole(null);
                        setProfilePic(null);
                        setProfilePicPreview(null);
                        setUsernameStatus('idle');
                        setEditingEmployeeId(null);
                        fetchEmployeeMaster();
                        invalidateEmployees();
                    }
                })
                .catch((err) => {
                    toast.error(err.response?.data?.message || "Cannot update Employee");
                })
                .finally(() => setIsLoading(false));
        }
    };

    const handleCancel = (e) => {
        e.preventDefault();
        setIsSubmit(false);
        setShowForm(false);
        setUpdateForm(false);
        setValues(initialState);
        setFormErrors({});
        setSelectedDepartment(null);
        setSelectedRole(null);
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteLoading(true);
        deleteEmployee(remove_id)
            .then((res) => {
                setmodal_delete(!modal_delete);
                fetchEmployeeMaster();
                invalidateEmployees();
                toast.success("Employee Deleted Successfully");
            })
            .catch((err) => {
                console.log(err);
                toast.error("Cannot delete Employee");
            })
            .finally(() => setIsDeleteLoading(false));
    };

    const handleDeleteClose = (e) => {
        e.preventDefault();
        setmodal_delete(false);
    };

    const handleTog_edit = async (_id) => {
        setIsSubmit(false);
        setUpdateForm(true);
        set_Id(_id);
        setEditingEmployeeId(_id);
        setFormErrors({});
        setIsLoading(true);
        setShowResetPassword(false);
        setUsernameStatus('idle');
        try {
            const res = await getEmployeeById(_id);
            if (res.data.isOk) {
                const emp = res.data.data;
                const formattedDate = emp.joiningDate ? new Date(emp.joiningDate).toISOString().split('T')[0] : "";
                
                setValues({
                    ...initialState,
                    employeeCode: emp.employeeCode || "",
                    employeeName: emp.employeeName || "",
                    username: emp.username || "",
                    departmentIds: emp.departmentIds?.map(d => ({ value: d._id, label: d.departmentName })) || [],
                    teamIds: emp.teamIds?.map(t => ({ value: t._id, label: t.teamName })) || [],
                    skills: emp.skills?.map(s => ({ value: s, label: s })) || [],
                    joiningDate: formattedDate,
                    emailOffice: emp.emailOffice || "",
                    mobileNumber: emp.mobileNumber || "",
                    address: emp.address || "",
                    remark: emp.remark || "",
                    isActive: emp.isActive,
                });
                
                if (emp.profilePic) {
                    setProfilePicPreview(emp.profilePic);
                } else {
                    setProfilePicPreview(null);
                }
                setProfilePic(null);

                if (emp.roleId) {
                    setSelectedRole({ value: emp.roleId._id, label: emp.roleId.roleName });
                }
                
                setInitialFormData(JSON.stringify({
                    values: {
                        ...initialState,
                        employeeCode: emp.employeeCode || "",
                        employeeName: emp.employeeName || "",
                        username: emp.username || "",
                        departmentIds: emp.departmentIds?.map(d => ({ value: d._id, label: d.departmentName })) || [],
                        teamIds: emp.teamIds?.map(t => ({ value: t._id, label: t.teamName })) || [],
                            skills: emp.skills?.map(s => ({ value: s, label: s })) || [],
                        joiningDate: formattedDate,
                        emailOffice: emp.emailOffice || "",
                        mobileNumber: emp.mobileNumber || "",
                        address: emp.address || "",
                        remark: emp.remark || "",
                        isActive: emp.isActive,
                    },
                    selectedRole: emp.roleId ? { value: emp.roleId._id, label: emp.roleId.roleName } : null,
                    profilePic: null
                }));
            }
        } catch (err) {
            toast.error("Failed to fetch employee details");
        } finally {
            setIsLoading(false);
        }
    };


    const [modal_delete, setmodal_delete] = useState(false);
    const tog_delete = (_id) => {
        setmodal_delete(!modal_delete);
        setRemove_id(_id);
    };

    const handlecheck = (e) => {
        setValues({ ...values, [e.target.name]: e.target.checked });
    };

    const handleChange = async (e) => {
        const { name, value } = e.target;
        let newValue = value;

        if (name === "employeeShortName") {
            newValue = value.toUpperCase();
            setValues({ ...values, [name]: newValue });
        } else {
            setValues({ ...values, [name]: newValue });
        }
    };

    const handleSort = (column, sortDirection) => {
        setcolumn(column.sortField);
        setsortDirection(sortDirection);
    };

    const handlePageChange = (page) => {
        setPageNo(page);
    };

    const handlePerRowsChange = async (newPerPage, page) => {
        setPerPage(newPerPage);
    };

    const handleFilter = (e) => {
        setFilter(e.target.checked);
    };

    const handlePasswordResetChange = (e) => {
        setResetPasswordData({
            ...resetPasswordData,
            [e.target.name]: e.target.value,
        });
    };

    const toggleResetPassword = () => {
        setShowResetPassword(!showResetPassword);
        setPasswordResetError("");
        setResetPasswordData({
            newPassword: "",
            confirmPassword: "",
        });
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();

        // Validate passwords
        if (resetPasswordData.newPassword !== resetPasswordData.confirmPassword) {
            setPasswordResetError("Passwords do not match");
            return;
        }

        if (resetPasswordData.newPassword.length < 6) {
            setPasswordResetError("Password must be at least 6 characters");
            return;
        }

        setIsLoading(true);

        try {
            const response = await resetEmployeePassword(_id, { password: resetPasswordData.newPassword });

            if (response && response.data && response.data.isOk) {
                toast.success("Password reset successfully");
                setShowResetPassword(false);
                setResetPasswordData({
                    newPassword: "",
                    confirmPassword: "",
                });
                setPasswordResetError("");
            } else {
                toast.error("Failed to reset password");
            }
        } catch (error) {
            console.error("Error resetting password:", error);
            toast.error("Failed to reset password");
        } finally {
            setIsLoading(false);
        }
    };

    // Quick-add Role handler
    const handleAddRole = async (e) => {
        e.preventDefault();
        if (!newRoleData.roleName || !newRoleData.roleCode) {
            toast.error("Role Name and Role Code are required");
            return;
        }
        setAddRoleLoading(true);
        try {
            const res = await createRole({ roleName: newRoleData.roleName, roleCode: newRoleData.roleCode, isActive: true });
            if (res.data?.isOk) {
                toast.success("Role added successfully");
                await invalidateRoles();
                setTimeout(() => {
                    const newRole = { value: res.data.data?._id, label: newRoleData.roleName };
                    setSelectedRole(newRole);
                }, 300);
                setShowAddRoleModal(false);
                setNewRoleData({ roleName: "", roleCode: "" });
            } else {
                toast.error(res.data?.message || "Failed to add role");
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to add role");
        } finally {
            setAddRoleLoading(false);
        }
    };

    // Quick-add Department handler
    const handleAddDept = async (e) => {
        e.preventDefault();
        if (!newDeptData.departmentName || !newDeptData.departmentCode) {
            toast.error("Department Name and Code are required");
            return;
        }
        setAddDeptLoading(true);
        try {
            const res = await createDepartment({ departmentName: newDeptData.departmentName, departmentCode: newDeptData.departmentCode, isActive: true });
            if (res.data?.isOk) {
                toast.success("Department added successfully");
                await invalidateDepartments();
                setTimeout(() => {
                    const newDept = { value: res.data.data?._id, label: newDeptData.departmentName };
                    setSelectedDepartment(newDept);
                }, 300);
                setShowAddDeptModal(false);
                setNewDeptData({ departmentName: "", departmentCode: "" });
            } else {
                toast.error(res.data?.message || "Failed to add department");
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to add department");
        } finally {
            setAddDeptLoading(false);
        }
    };

    // Quick-add Team handler
    const handleAddTeam = async (e) => {
        e.preventDefault();
        if (!newTeamData.teamName) {
            toast.error("Team Name is required");
            return;
        }
        setAddTeamLoading(true);
        try {
            const res = await createTeam({ teamName: newTeamData.teamName, description: newTeamData.description, isActive: true });
            if (res.data?.isOk) {
                toast.success("Team added successfully");
                await invalidateTeams();
                setTimeout(() => {
                    const newTeam = { value: res.data.data?._id, label: newTeamData.teamName };
                    setValues(prev => ({...prev, teamIds: [...prev.teamIds, newTeam]}));
                }, 300);
                setShowAddTeamModal(false);
                setNewTeamData({ teamName: "", description: "" });
            } else {
                toast.error(res.data?.message || "Failed to add team");
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to add team");
        } finally {
            setAddTeamLoading(false);
        }
    };

    const renderForm = () => (
        <CardBody>
            <Col xxl={12}>
                <Card>
                    <CardBody>
                        <div className="live-preview">
                            <Form>
                                <Row>
                                    <Row>
                                        {/* Employee Code */}
                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Employee Code</label>
                                                <input
                                                    type="text"
                                                    className="form-control"
                                                    name="employeeCode"
                                                    value={values.employeeCode}
                                                    onChange={handleChange}
                                                    placeholder="Enter employee code..."
                                                    maxLength="10"
                                                />
                                            </div>
                                        </Col>
                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                                                    Full Name <span className="text-danger">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    className="form-control"
                                                    required
                                                    name="employeeName"
                                                    value={values.employeeName}
                                                    onChange={handleChange}
                                                    placeholder="Enter full name..."
                                                    maxLength="20"
                                                />
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.employeeName}</p>}
                                            </div>
                                        </Col>
                                        {/* Username */}
                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Username <span className="text-danger">*</span></label>
                                                <input
                                                    type="text"
                                                    className={`form-control ${usernameStatus === 'taken' ? 'is-invalid' :
                                                            usernameStatus === 'available' ? 'is-valid' : ''
                                                        }`}
                                                    name="username"
                                                    value={values.username}
                                                    onChange={handleUsernameChange}
                                                    placeholder="Enter username..."
                                                    required
                                                    maxLength="15"
                                                />
                                                <div className="d-flex justify-content-between align-items-center mt-1">
                                                    <small className="text-muted" style={{ fontSize: "10px" }}>
                                                        {usernameStatus === 'checking' && 'Checking…'}
                                                        {usernameStatus === 'available' && <span className="text-success">✓ Available</span>}
                                                        {usernameStatus === 'taken' && <span className="text-danger">✗ Already taken</span>}
                                                        {usernameStatus === 'short' && 'Min. 3 characters'}
                                                        {usernameStatus === 'idle' && 'Lower case & numbers'}
                                                    </small>
                                                </div>
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.username}</p>}
                                            </div>
                                        </Col>
                                        {/* Password */}
                                        {!updateForm && (
                                            <Col lg={4}>
                                                <div className="mb-3">
                                                    <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                                                        Password <span className="text-danger">*</span>
                                                    </label>
                                                    <input
                                                        type="password"
                                                        className="form-control"
                                                        required
                                                        name="password"
                                                        value={values.password}
                                                        onChange={handleChange}
                                                        placeholder="Enter password..."
                                                        maxLength="15"
                                                    />
                                                    {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.password}</p>}
                                                </div>
                                            </Col>
                                        )}
                                    </Row>

                                    {/* Row 2: Role, Teams, Department */}
                                    <Row>
                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                                                    Role <span className="text-danger"> *</span>
                                                </label>
                                                <div className="d-flex gap-1 align-items-center">
                                                    <div style={{ flex: 1 }}>
                                                        <Select
                                                            className="basic-single"
                                                            classNamePrefix="select" menuPortalTarget={document.body} styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                                                            placeholder="Select Role…"
                                                            options={roleList.map((role) => ({ value: role._id, label: role.roleName }))}
                                                            value={selectedRole}
                                                            onChange={(opt) => setSelectedRole(opt)}
                                                        />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-primary btn-sm"
                                                        style={{ whiteSpace: "nowrap" }}
                                                        onClick={() => setShowAddRoleModal(true)}
                                                        title="Add new role"
                                                    >
                                                        + Add
                                                    </button>
                                                </div>
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.role}</p>}
                                            </div>
                                        </Col>

                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                                                    Teams
                                                </label>
                                                <div className="d-flex gap-1 align-items-center">
                                                    <div style={{ flex: 1 }}>
                                                        <Select
                                                            className="basic-single"
                                                            classNamePrefix="select" menuPortalTarget={document.body} styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                                                            placeholder="Select Teams…"
                                                            isMulti
                                                            options={teamList.map((team) => ({ value: team._id, label: team.teamName }))}
                                                            value={values.teamIds}
                                                            onChange={(opt) => setValues({...values, teamIds: opt || []})}
                                                        />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-primary btn-sm"
                                                        style={{ whiteSpace: "nowrap" }}
                                                        onClick={() => setShowAddTeamModal(true)}
                                                        title="Add new team"
                                                    >
                                                        + Add
                                                    </button>
                                                </div>
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.team}</p>}
                                            </div>
                                        </Col>

                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>
                                                    Department
                                                </label>
                                                <div className="d-flex gap-1 align-items-center">
                                                    <div style={{ flex: 1 }}>
                                                        <Select
                                                            className="basic-single"
                                                            classNamePrefix="select" menuPortalTarget={document.body} styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                                                            placeholder="Select Department…"
                                                            isMulti
                                                            options={departmentList.map((dept) => ({ value: dept._id, label: dept.departmentName }))}
                                                            value={values.departmentIds}
                                                            onChange={(opt) => setValues({...values, departmentIds: opt || []})}
                                                        />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-primary btn-sm"
                                                        style={{ whiteSpace: "nowrap" }}
                                                        onClick={() => setShowAddDeptModal(true)}
                                                        title="Add new department"
                                                    >
                                                        + Add
                                                    </button>
                                                </div>
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.department}</p>}
                                            </div>
                                        </Col>

                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Mobile Number</label>
                                                <input
                                                    type="text"
                                                    className={`form-control ${isSubmit && formErrors.mobileNumber ? 'is-invalid' : ''}`}
                                                    name="mobileNumber"
                                                    value={values.mobileNumber}
                                                    onChange={(e) => {
                                                        const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
                                                        setValues((prev) => ({ ...prev, mobileNumber: v }));
                                                    }}
                                                    placeholder="Enter mobile number..."
                                                    maxLength="10"
                                                    inputMode="numeric"
                                                />
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.mobileNumber}</p>}
                                            </div>
                                        </Col>

                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Office Email <span className="text-muted small">(optional)</span></label>
                                                <input
                                                    type="email"
                                                    className={`form-control ${isSubmit && formErrors.emailOffice ? 'is-invalid' : ''}`}
                                                    name="emailOffice"
                                                    value={values.emailOffice}
                                                    onChange={handleChange}
                                                    placeholder="Enter office email..."
                                                    maxLength="30"
                                                />
                                                {isSubmit && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.emailOffice}</p>}
                                            </div>
                                        </Col>
                                    </Row>

                                    {/* Skills, Joining Date, Profile Pic */}
                                    <Row className="mb-3">
                                        <Col lg={4}>
                                            <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Skills</label>
                                            <CreatableSelect 
                                                isMulti 
                                                className="basic-single" 
                                                classNamePrefix="select" menuPortalTarget={document.body} styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }} 
                                                placeholder="Enter skills..."
                                                options={dbSkills}
                                                value={values.skills}
                                                onChange={(opt) => setValues({...values, skills: opt || []})}
                                            />
                                        </Col>
                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Joining Date</label>
                                                <div className="d-block w-100">
                                                    <DatePicker
                                                        className="form-control w-100"
                                                        selected={values.joiningDate ? new Date(values.joiningDate) : null}
                                                        onChange={(date) => setValues({ ...values, joiningDate: date })}
                                                        dateFormat="dd/MM/yyyy"
                                                        placeholderText="dd/mm/yyyy"
                                                        isClearable
                                                        showMonthDropdown
                                                        showYearDropdown
                                                        dropdownMode="select"
                                                        wrapperClassName="w-100"
                                                    />
                                                </div>
                                            </div>
                                        </Col>
                                        <Col lg={4}>
                                            <div className="mb-3">
                                                <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Profile Picture</label>
                                                <div className="d-flex align-items-center gap-2">
                                                    {profilePicPreview && (
                                                        <img 
                                                            src={profilePicPreview} 
                                                            alt="Preview" 
                                                            style={{ width: "40px", height: "40px", borderRadius: "50%", objectFit: "cover", border: "1px solid #ccc" }} 
                                                        />
                                                    )}
                                                    <input
                                                        type="file"
                                                        className="form-control form-control-sm"
                                                        accept="image/*"
                                                        onChange={(e) => {
                                                        const file = e.target.files[0];
                                                        if (file) {
                                                            if (file.size > 2 * 1024 * 1024) {
                                                                toast.error("Profile picture size must be less than 2MB");
                                                                e.target.value = null;
                                                                return;
                                                            }
                                                            setProfilePic(file);
                                                            setProfilePicPreview(URL.createObjectURL(file));
                                                        } else {
                                                            setProfilePic(null);
                                                            setProfilePicPreview(null);
                                                        }
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </Col>
                                    </Row>

                                    {/* Row 4: Address + Remark */}
                                    <Row>
                                        <Col lg={6}>
                                            <div className="form-floating mb-3">
                                                <textarea
                                                    className="form-control"
                                                    style={{ height: "100px" }}
                                                    name="address"
                                                    value={values.address}
                                                    onChange={handleChange}
                                                    placeholder="Address"
                                                    maxLength={150}
                                                />
                                                <label className="form-label">Address</label>
                                                <div className="d-flex justify-content-end">
                                                    <small className="text-muted">{(values.address || "").length}/150</small>
                                                </div>
                                            </div>
                                        </Col>
                                        <Col lg={6}>
                                            <div className="form-floating mb-3">
                                                <textarea
                                                    className={`form-control ${isSubmit && formErrors.remark ? 'is-invalid' : ''
                                                        }`}
                                                    style={{ height: "100px" }}
                                                    name="remark"
                                                    value={values.remark}
                                                    onChange={handleChange}
                                                    placeholder="Remark"
                                                    maxLength={150}
                                                />
                                                <label className="form-label">Remark</label>
                                                <div className="d-flex justify-content-between">
                                                    {isSubmit && formErrors.remark
                                                        ? <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.remark}</p>
                                                        : <span />}
                                                    <small className="text-muted">{(values.remark || "").length}/150</small>
                                                </div>
                                            </div>
                                        </Col>
                                    </Row>

                                    {/* Password Reset Section - Only show in edit mode */}
                                    {updateForm && currentPagePermissions.edit && (
                                        <Row className="mt-4 mb-4">
                                            <Col lg={12}>
                                                <div className="d-flex align-items-center mb-2">
                                                    <h5 className="mb-0">Reset Password</h5>
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-primary ms-2"
                                                        onClick={toggleResetPassword}
                                                    >
                                                        {showResetPassword ? "Cancel" : "Change Password"}
                                                    </button>
                                                </div>

                                                {showResetPassword && (
                                                    <div className="password-reset-container border rounded p-3">
                                                        <Row>
                                                            <Col lg={5}>
                                                                <div className="position-relative mb-3">
                                                                    <Label className="form-label">
                                                                        New Password <span className="text-danger">*</span>
                                                                    </Label>
                                                                    <div className="position-relative">
                                                                        <Input
                                                                            type={showNewPassword ? "text" : "password"}
                                                                            className="form-control"
                                                                            required
                                                                            name="newPassword"
                                                                            value={resetPasswordData.newPassword}
                                                                            onChange={handlePasswordResetChange}
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-link position-absolute end-0 top-0 text-decoration-none text-muted"
                                                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                                                            tabIndex={-1}
                                                                        >
                                                                            <i className={`ri-eye${showNewPassword ? "" : "-off"}-line align-middle`}></i>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </Col>
                                                            <Col lg={5}>
                                                                <div className="position-relative mb-3">
                                                                    <Label className="form-label">
                                                                        Confirm Password <span className="text-danger">*</span>
                                                                    </Label>
                                                                    <div className="position-relative">
                                                                        <Input
                                                                            type={showConfirmPassword ? "text" : "password"}
                                                                            className="form-control"
                                                                            required
                                                                            name="confirmPassword"
                                                                            value={resetPasswordData.confirmPassword}
                                                                            onChange={handlePasswordResetChange}
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-link position-absolute end-0 top-0 text-decoration-none text-muted"
                                                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                                            tabIndex={-1}
                                                                        >
                                                                            <i className={`ri-eye${showConfirmPassword ? "" : "-off"}-line align-middle`}></i>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </Col>
                                                            <Col lg={2}>
                                                                <div className="d-flex align-items-end h-100 mb-3">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-success"
                                                                        onClick={handleResetPassword}
                                                                        disabled={isLoading || resetPasswordData.newPassword.length < 6 || resetPasswordData.newPassword !== resetPasswordData.confirmPassword}
                                                                    >
                                                                        Reset Password
                                                                    </button>
                                                                </div>
                                                            </Col>
                                                        </Row>
                                                        {passwordResetError && (
                                                            <div className="text-danger">{passwordResetError}</div>
                                                        )}
                                                    </div>
                                                )}
                                            </Col>
                                        </Row>
                                    )}

                                    <div className="mt-5">
                                        <Row>
                                            <Col lg={2}>
                                                <div className="form-check mb-2">
                                                    <Input
                                                        type="checkbox"
                                                        name="isActive"
                                                        checked={values.isActive}
                                                        onChange={handlecheck}
                                                    />
                                                    <Label className="form-check-label">
                                                        Is Active
                                                    </Label>
                                                </div>
                                            </Col>
                                        </Row>
                                    </div>
                                    <Col lg={12}>
                                        <FormsFooter
                                            handleSubmit={updateForm ? handleUpdate : handleClick}
                                            handleSubmitCancel={handleCancel}
                                            isLoading={isLoading}
                                            isSaveDisabled={!isFormDirty}
                                        />
                                    </Col>
                                </Row>
                            </Form>
                        </div>
                    </CardBody>
                </Card>
            </Col>
        </CardBody>
    );

    const handleList = () => {
        setShowForm(false);
        setUpdateForm(false);
        setIsSubmit(false);
        setValues(initialState);
        setSelectedDepartment(null);
        setSelectedRole(null);
        setFormErrors({});
        setShowResetPassword(false);
    }

    const currentFormData = JSON.stringify({
        values,
        selectedRole,
        profilePic: profilePic ? profilePic.name : null
    });
    const isFormDirty = currentFormData !== initialFormData;

    document.title = `Employee | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

    return (
        <React.Fragment>
            <ConfirmAlert
                isOpen={blockAlert.open}
                variant={!blockAlert.row?.isBlocked ? "danger" : "info"}
                title={!blockAlert.row?.isBlocked ? "Block Employee?" : "Unblock Employee?"}
                message={
                    !blockAlert.row?.isBlocked
                        ? `${blockAlert.row?.employeeName} will be blocked from accessing the system.`
                        : `${blockAlert.row?.employeeName} will regain access to the system.`
                }
                confirmText={!blockAlert.row?.isBlocked ? "Yes, Block" : "Yes, Unblock"}
                cancelText="Cancel"
                onCancel={() => setBlockAlert({ open: false, row: null })}
                onConfirm={async () => {
                    const row = blockAlert.row;
                    setBlockAlert({ open: false, row: null });
                    try {
                        const res = await updateEmployee(row._id, { isBlocked: !row.isBlocked });
                        if (res.data?.isOk) {
                            toast.success(!row.isBlocked ? `${row.employeeName} has been blocked.` : `${row.employeeName} has been unblocked.`);
                            fetchEmployeeMaster();
                        }
                    } catch (err) {
                        toast.error("Failed to update employee status.");
                    }
                }}
            />
            <div className="page-content">
                <Container fluid>
                    <Row>
                        <Col lg={12}>
                            <Card>
                                <CardHeader>
                                    <FormsHeader
                                        formName="Employee"
                                        filter={filter}
                                        handleFilter={handleFilter}
                                        tog_list={() => {
                                            setValues(initialState);
                                            setSelectedDepartment(null);
                                            setSelectedRole(null);
                                            setFormErrors({});
                                            setIsSubmit(false);
                                            setUpdateForm(false);
                                            setShowForm(true);
                                            setInitialFormData(JSON.stringify({
                                                values: initialState,
                                                selectedRole: null,
                                                profilePic: null
                                            }));
                                        }}
                                        setQuery={setQuery}
                                        initialState={initialState}
                                        setValues={setValues}
                                        updateForm={updateForm}
                                        showForm={showForm}
                                        setShowForm={setShowForm}
                                        setUpdateForm={setUpdateForm}
                                        showAddButton={currentPagePermissions.create}
                                        handleSave={updateForm ? handleUpdate : handleClick}
                                        handleCancel={handleCancel}
                                        isSaveDisabled={!isFormDirty}
                                        isLoading={isLoading}
                                    />
                                </CardHeader>

                                {(showForm || updateForm) ? (
                                    renderForm()
                                ) : (
                                    <CardBody>
                                        <div className="table-responsive table-card mt-1 mb-1 text-right">
                                            <DataTable
                                                columns={columns}
                                                data={data}
                                                progressPending={loading}
                                                sortServer
                                                onSort={(column, sortDirection) =>
                                                    handleSort(column, sortDirection)
                                                }
                                                pagination
                                                paginationServer
                                                paginationComponentOptions={{ noRowsPerPage: true }}
                                                paginationTotalRows={totalRows}
                                                paginationPerPage={100}
                                                onChangePage={handlePageChange}
                                            />
                                        </div>
                                    </CardBody>
                                )}
                            </Card>
                        </Col>
                    </Row>
                </Container>
            </div>

            <DeleteModal
                show={modal_delete}
                handleDelete={handleDelete}
                toggle={handleDeleteClose}
                setmodal_delete={setmodal_delete}
                disabled={isDeleteLoading}
            />

            {/* Quick-Add Role Modal */}
            <Modal isOpen={showAddRoleModal} toggle={() => { setShowAddRoleModal(false); setNewRoleData({ roleName: "", roleCode: "", remark: "", isActive: true }); }} centered>
                <ModalHeader className="p-3 border-bottom" toggle={() => { setShowAddRoleModal(false); setNewRoleData({ roleName: "", roleCode: "", remark: "", isActive: true }); }}>
                    Add Role
                </ModalHeader>
                <form noValidate onSubmit={handleAddRole}>
                    <ModalBody>
                        <div className="mb-3">
                            <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Role Name <span className="text-danger">*</span></label>
                            <Input
                                type="text"
                                className="form-control"
                                placeholder="Enter role name..."
                                value={newRoleData.roleName}
                                onChange={(e) => setNewRoleData((p) => ({ ...p, roleName: e.target.value }))}
                                required
                            />
                        </div>
                        <div className="mb-3">
                            <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Role Code <span className="text-danger">*</span></label>
                            <Input
                                type="text"
                                className="form-control"
                                placeholder="Enter role code..."
                                value={newRoleData.roleCode}
                                onChange={(e) => setNewRoleData((p) => ({ ...p, roleCode: e.target.value }))}
                                required
                            />
                        </div>
                        <div className="mb-3">
                            <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>Remark</label>
                            <textarea
                                className="form-control"
                                style={{ height: "80px" }}
                                value={newRoleData.remark}
                                onChange={(e) => setNewRoleData((p) => ({ ...p, remark: e.target.value }))}
                                placeholder="Enter remarks..."
                                maxLength={200}
                            />
                            <div className="d-flex justify-content-end mt-1">
                                <small className="text-muted">{(newRoleData.remark || "").length}/200</small>
                            </div>
                        </div>
                        <div className="mb-3 flex items-center">
                            <Input
                                type="checkbox"
                                className="form-check-input mt-0"
                                checked={newRoleData.isActive}
                                onChange={(e) => setNewRoleData((p) => ({ ...p, isActive: e.target.checked }))}
                            />
                            <Label className="form-check-label ms-2 mb-0">Is Active</Label>
                        </div>
                    </ModalBody>
                    <div className="p-3 border-top bg-slate-50 rounded-b">
                        <FormsFooter 
                            handleSubmitCancel={() => { setShowAddRoleModal(false); setNewRoleData({ roleName: "", roleCode: "", remark: "", isActive: true }); }}
                            isLoading={addRoleLoading}
                            isSaveDisabled={!newRoleData.roleName || !newRoleData.roleCode}
                        />
                    </div>
                </form>
            </Modal>

            {/* Quick-Add Department Modal */}
            <Modal isOpen={showAddDeptModal} toggle={() => { setShowAddDeptModal(false); setNewDeptData({ departmentName: "", departmentCode: "", remark: "", isActive: true, hodIds: [] }); }} centered>
                <ModalHeader className="p-3 border-bottom" toggle={() => { setShowAddDeptModal(false); setNewDeptData({ departmentName: "", departmentCode: "", remark: "", isActive: true, hodIds: [] }); }}>
                    Add Department
                </ModalHeader>
                <form noValidate onSubmit={handleAddDept}>
                    <ModalBody>
                        <Row>
                            <Col md={6}>
                                <div className="form-floating mb-3">
                                    <Input
                                        type="text"
                                        className="form-control"
                                        placeholder=" "
                                        value={newDeptData.departmentName}
                                        onChange={(e) => setNewDeptData((p) => ({ ...p, departmentName: e.target.value }))}
                                        required
                                        maxLength={15}
                                        style={{ color: '#111827', fontWeight: '500' }}
                                    />
                                    <Label>Department Name <span className="text-danger">*</span></Label>
                                </div>
                            </Col>
                            <Col md={6}>
                                <div className="form-floating mb-3">
                                    <Input
                                        type="text"
                                        className="form-control"
                                        placeholder=" "
                                        value={newDeptData.departmentCode}
                                        onChange={(e) => setNewDeptData((p) => ({ ...p, departmentCode: e.target.value }))}
                                        required
                                        maxLength={10}
                                        style={{ color: '#111827', fontWeight: '500' }}
                                    />
                                    <Label>Department Code <span className="text-danger">*</span></Label>
                                </div>
                            </Col>
                        </Row>
                        <div className="form-floating mb-3">
                            <textarea
                                className="form-control"
                                style={{ height: "80px", color: '#111827', fontWeight: '500' }}
                                value={newDeptData.remark}
                                onChange={(e) => setNewDeptData((p) => ({ ...p, remark: e.target.value }))}
                                placeholder=" "
                                maxLength={50}
                            />
                            <Label>Description</Label>
                        </div>
                        <div className="mb-3">
                            <label className="form-label" style={{ fontSize: "0.75rem", opacity: 0.8, marginBottom: "2px" }}>HOD / Department Head</label>
                            <Select
                                isMulti
                                options={data.map((emp) => ({ value: emp._id, label: emp.employeeName }))}
                                value={data.map((emp) => ({ value: emp._id, label: emp.employeeName })).filter(opt => (newDeptData.hodIds || []).includes(opt.value))}
                                onChange={(selected) => setNewDeptData((p) => ({ ...p, hodIds: selected.map(s => s.value) }))}
                                closeMenuOnSelect={false}
                                hideSelectedOptions={false}
                                placeholder="Select HOD(s)..."
                                classNamePrefix="select" menuPortalTarget={document.body} styles={{ menuPortal: base => ({ ...base, zIndex: 9999 }) }}
                            />
                        </div>
                        <div className="mb-3 flex items-center">
                            <Input
                                type="checkbox"
                                className="form-check-input mt-0"
                                checked={newDeptData.isActive}
                                onChange={(e) => setNewDeptData((p) => ({ ...p, isActive: e.target.checked }))}
                            />
                            <Label className="form-check-label ms-2 mb-0">Is Active</Label>
                        </div>
                    </ModalBody>
                    <div className="p-3 border-top bg-slate-50 rounded-b">
                        <FormsFooter 
                            handleSubmitCancel={() => { setShowAddDeptModal(false); setNewDeptData({ departmentName: "", departmentCode: "", remark: "", isActive: true, hodIds: [] }); }}
                            isLoading={addDeptLoading}
                            isSaveDisabled={!newDeptData.departmentName || !newDeptData.departmentCode}
                        />
                    </div>
                </form>
            </Modal>

            {/* Quick-add Team Modal */}
            <Modal isOpen={showAddTeamModal} toggle={() => { setShowAddTeamModal(false); setNewTeamData({ teamName: "", description: "", teamLeadId: null, memberIds: [], remark: "", isActive: true }); }} centered>
                <ModalHeader className="p-3 border-bottom" toggle={() => { setShowAddTeamModal(false); setNewTeamData({ teamName: "", description: "", teamLeadId: null, memberIds: [], remark: "", isActive: true }); }}>
                    Add Team
                </ModalHeader>
                <form noValidate onSubmit={handleAddTeam}>
                    <ModalBody>
                        <div className="form-floating mb-3">
                            <Input
                                type="text"
                                className="form-control"
                                placeholder=" "
                                value={newTeamData.teamName}
                                onChange={(e) => setNewTeamData((p) => ({ ...p, teamName: e.target.value }))}
                                required
                                maxLength={30}
                                style={{ color: '#111827', fontWeight: '500' }}
                            />
                            <Label>Team Name <span className="text-danger">*</span></Label>
                        </div>
                        <div className="form-floating mb-3">
                            <textarea
                                className="form-control"
                                style={{ height: "80px", color: '#111827', fontWeight: '500' }}
                                value={newTeamData.description}
                                onChange={(e) => setNewTeamData((p) => ({ ...p, description: e.target.value }))}
                                placeholder=" "
                                maxLength={100}
                            />
                            <Label>Description</Label>
                        </div>
                    </ModalBody>
                    <div className="p-3 border-top bg-slate-50 rounded-b">
                        <FormsFooter 
                            handleSubmitCancel={() => { setShowAddTeamModal(false); setNewTeamData({ teamName: "", description: "", teamLeadId: null, memberIds: [], remark: "", isActive: true }); }}
                            isLoading={addTeamLoading}
                            isSaveDisabled={!newTeamData.teamName}
                        />
                    </div>
                </form>
            </Modal>
        </React.Fragment>
    );
};

export default Employee;