import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2 } from "lucide-react";
import ConfirmAlert from "../Components/Common/ConfirmAlert";
import {
    Input,
    Label,
    Card,
    CardBody,
    CardHeader,
    Col,
    Container,
    Row,
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Button,
} from "reactstrap";
import DataTable from "react-data-table-component";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import DeleteModal from "../Components/Common/DeleteModal";
import { useAlert } from "../context/AlertContext";
import { AuthContext } from "../context/AuthContext";
import { MenuContext } from "../context/MenuContext";
import { getSkills, getSkillById, createSkill, updateSkill, deleteSkill } from "../api/skills.api";

const initialState = {
    skillName: "",
    skillDescription: "",
    isActive: true,
};

const Skills = () => {
    const toast = useAlert();
    const { adminData } = useContext(AuthContext);
    const { currentPagePermissions } = useContext(MenuContext);

    const [isLoading, setIsLoading] = useState(false);
    const [isSubmit, setIsSubmit] = useState(false);
    const [filter, setFilter] = useState(true);
    const [_id, set_Id] = useState("");

    const [modal_delete, setmodal_delete] = useState(false);
    const [remove_id, setRemove_id] = useState("");
    const [query, setQuery] = useState("");
    const [values, setValues] = useState(initialState);
    const [formErrors, setFormErrors] = useState({});

    // Data
    const [skillsList, setSkillsList] = useState([]);

    // Modal
    const [showFormModal, setShowFormModal] = useState(false);
    const [updateForm, setUpdateForm] = useState(false);

    useEffect(() => {
        fetchSkills();
    }, [filter]);

    const fetchSkills = async () => {
        try {
            const res = await getSkills({ isActive: filter ? "true" : undefined });
            if (res.data.isOk) {
                setSkillsList(res.data.data);
            }
        } catch (err) {
            console.error("Failed to fetch skills", err);
        }
    };

    const handlecheck = (e) => {
        setValues({ ...values, [e.target.name]: e.target.checked });
    };

    const handleChange = (e) => {
        setValues({ ...values, [e.target.name]: e.target.value });
    };

    const validate = (values) => {
        const errors = {};
        if (!values.skillName) {
            errors.skillName = "Skill Name is required!";
        }
        return errors;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmit(true);
        const errors = validate(values);
        setFormErrors(errors);

        if (Object.keys(errors).length === 0) {
            setIsLoading(true);
            try {
                let res;
                if (updateForm) {
                    res = await updateSkill(_id, values);
                } else {
                    res = await createSkill(values);
                }

                if (res.data.isOk) {
                    toast.success(res.data.message || "Skill saved successfully");
                    fetchSkills();
                    closeFormModal();
                } else {
                    toast.error(res.data.message || "Operation failed");
                }
            } catch (err) {
                toast.error(err.response?.data?.message || "An error occurred");
            } finally {
                setIsLoading(false);
            }
        }
    };

    const closeFormModal = () => {
        setShowFormModal(false);
        setUpdateForm(false);
        setValues(initialState);
        setFormErrors({});
        setIsSubmit(false);
        set_Id("");
    };

    const handleEdit = async (id) => {
        setUpdateForm(true);
        setIsLoading(true);
        try {
            const res = await getSkillById(id);
            if (res.data.isOk) {
                const data = res.data.data;
                setValues({
                    skillName: data.skillName || "",
                    skillDescription: data.skillDescription || "",
                    isActive: data.isActive,
                });
                set_Id(id);
                setShowFormModal(true);
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to fetch details");
        } finally {
            setIsLoading(false);
        }
    };

    const tog_delete = (id) => {
        setmodal_delete(!modal_delete);
        setRemove_id(id);
    };

    const handleDelete = async () => {
        try {
            const res = await deleteSkill(remove_id);
            if (res.data.isOk) {
                toast.success("Skill deleted successfully");
                fetchSkills();
            }
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to delete");
        } finally {
            setmodal_delete(false);
        }
    };

    const columns = [
        {
            name: "Skill Name",
            selector: (row) => row.skillName,
            sortable: true,
        },
        {
            name: "Description",
            selector: (row) => row.skillDescription,
            sortable: true,
        },
        {
            name: "Status",
            selector: (row) => (row.isActive ? "Active" : "Inactive"),
            minWidth: "150px",
        },
    ];

    if (currentPagePermissions.edit || currentPagePermissions.delete) {
        columns.push({
            name: "Action",
            cell: (row) => (
                <div className="d-flex gap-2">
                    {currentPagePermissions.edit && (
                        <button
                            className="btn btn-sm btn-soft-success btn-icon fs-14"
                            title="Edit"
                            onClick={() => handleEdit(row._id)}
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
                </div>
            ),
            width: "120px",
            sortable: false,
        });
    }

    const filteredData = skillsList.filter((item) =>
        item.skillName?.toLowerCase().includes(query.toLowerCase())
    );

    return (
        <React.Fragment>
            <div className="page-content">
                <Container fluid>
                    <Card>
                        <CardHeader>
                            <FormsHeader
                                formName="Skills"
                                filter={filter}
                                handleFilter={() => setFilter(!filter)}
                                tog_list={() => setShowFormModal(true)}
                                setQuery={setQuery}
                                currentPagePermissions={currentPagePermissions}
                                showAddButton={currentPagePermissions.create}
                            />
                        </CardHeader>
                        <CardBody>
                            <div className="table-responsive table-card mt-1 mb-1 text-right">
                            <DataTable
                                columns={columns}
                                data={filteredData}
                                pagination
                                highlightOnHover
                                className="react-dataTable"
                            />
                            </div>
                        </CardBody>
                    </Card>
                </Container>
            </div>

            <Modal isOpen={showFormModal} toggle={closeFormModal} size="md" centered>
                <ModalHeader toggle={closeFormModal}>
                    {updateForm ? "Edit Skill" : "Add Skill"}
                </ModalHeader>
                <ModalBody>
                    <div className="mb-3">
                        <Label>Skill Name <span className="text-danger">*</span></Label>
                        <Input
                            type="text"
                            name="skillName"
                            value={values.skillName}
                            onChange={handleChange}
                            maxLength={30}
                            className={isSubmit && formErrors.skillName ? "is-invalid" : ""}
                        />
                        {isSubmit && formErrors.skillName && (
                            <div className="invalid-feedback">{formErrors.skillName}</div>
                        )}
                        <small className="text-muted text-end block">{values.skillName.length}/30</small>
                    </div>
                    <div className="mb-3">
                        <Label>Description</Label>
                        <Input
                            type="textarea"
                            name="skillDescription"
                            value={values.skillDescription}
                            onChange={handleChange}
                            maxLength={150}
                            rows={3}
                        />
                        <small className="text-muted text-end block">{values.skillDescription.length}/150</small>
                    </div>
                    <div className="form-check form-switch">
                        <Input
                            type="checkbox"
                            className="form-check-input"
                            id="isActiveCheck"
                            name="isActive"
                            checked={values.isActive}
                            onChange={handlecheck}
                        />
                        <Label className="form-check-label" htmlFor="isActiveCheck">
                            Is Active
                        </Label>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button color="light" onClick={closeFormModal}>Cancel</Button>
                    <Button color="primary" onClick={handleSubmit} disabled={isLoading}>
                        {isLoading ? "Saving..." : "Save"}
                    </Button>
                </ModalFooter>
            </Modal>

            <ConfirmAlert
                isOpen={modal_delete}
                variant="danger"
                title="Delete Skill"
                message="Are you sure you want to delete this skill?"
                confirmText="Delete"
                cancelText="Cancel"
                onCancel={() => setmodal_delete(false)}
                onConfirm={handleDelete}
            />
        </React.Fragment>
    );
};

export default Skills;
