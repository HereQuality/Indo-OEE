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
import { createRole, getRoleById, deleteRole, updateRole, searchRoles } from "../api/roles.api";
import { useInvalidateRoles } from "../hooks/useRoles";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import ReferenceErrorModal from "../Components/Common/ReferenceErrorModal";
import { slugifyPreview } from "../utils/roleUrl";

const initialState = {
  roleName: "",
  roleCode: "",
  remark: "",
  isActive: true,
};

const RoleMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};
  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState("All");

  const [query, setQuery] = useState("");

  // Separate loading states for different operations
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [isUpdateLoading, setIsUpdateLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [isEditFetching, setIsEditFetching] = useState(false);

  const [_id, set_Id] = useState("");
  const [remove_id, setRemove_id] = useState("");

  const [roles, setRoles] = useState([]);
  const invalidateRoles = useInvalidateRoles();

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

  const [referenceModal, setReferenceModal] = useState(false);
  const [referenceData, setReferenceData] = useState(null);

  const [modal_edit, setmodal_edit] = useState(false);
  const handleTog_edit = (_id) => {
    setmodal_edit(!modal_edit);
    setIsSubmit(false);
    set_Id(_id);
    setIsEditFetching(true);
    getRoleById(_id)
      .then((res) => {
        setValues({
          ...values,
          roleName: res.data.data.roleName,
          roleCode: res.data.data.roleCode,
          remark: res.data.data.remark || "",
          isActive: res.data.data.isActive,
        });
      })
      .catch((err) => {
        console.log(err);
        toast.error("Failed to fetch role details");
      }).finally(() => {
        setIsEditFetching(false);
      });
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
    if (
      Object.keys(errors).length === 0
    ) {
      setIsSubmitLoading(true);
      createRole(values)
        .then((res) => {
          if (res.data.isOk) {
            toast.success("Role Added Successfully!");
            setmodal_list(!modal_list);
            setValues(initialState);
            fetchRoles();
            invalidateRoles();
          }
        })
        .catch((error) => {
          console.log(error);
          toast.error(error.response?.data?.message || "Failed to add role. Please try again.");
        }).finally(() => {
          setIsSubmitLoading(false);
        });
    }
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteRole(remove_id)
      .then((res) => {
        setmodal_delete(!modal_delete);
        fetchRoles();
        invalidateRoles();
        toast.success("Role Removed Successfully!");
      })
      .catch((err) => {
        console.log(err);
        setmodal_delete(false);

        if (err.response && err.response.status === 409) {
          // Handle reference error
          setReferenceData(err.response.data);
          setReferenceModal(true);
        } else {
          toast.error("Failed to delete role. Please try again.");
        }
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
      setIsUpdateLoading(true);
      updateRole(_id, values)
        .then((res) => {
          setmodal_edit(!modal_edit);
          fetchRoles();
          invalidateRoles();
          toast.success("Role Updated Successfully!");
        })
        .catch((err) => {
          console.log(err);
          toast.error(err.response?.data?.message || "Failed to update role. Please try again.");
        }).finally(() => {
          setIsUpdateLoading(false);
        });
    }
  };

  const validate = (values) => {
    const errors = {};

    if (values.roleName === "") {
      errors.roleName = "Role Name is required!";
    }

    if (values.roleCode === "") {
      errors.roleCode = "Role Code is required!";
    }

    if (values.remark && values.remark.length > 200) {
      errors.remark = "Remark must not exceed 200 characters";
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
    fetchRoles();
  }, [pageNo, perPage, column, sortDirection, query, filter]);

  const fetchRoles = async () => {
    setLoading(true);
    let skip = (pageNo - 1) * perPage;
    if (skip < 0) {
      skip = 0;
    }

    await searchRoles({
      skip: skip,
      per_page: perPage,
      sorton: column,
      sortdir: sortDirection,
      match: query,
      isActive: filter === "Active" ? true : filter === "Inactive" ? false : undefined,
    })
      .then((response) => {
        if (response.data.data.length > 0) {
          let res = response.data.data[0];
          setRoles(res.data);
          setTotalRows(response.data.data[0].count);
          setLoading(false);
        } else if (response.data.data.length === 0) {
          setRoles([]);
        }
      });

    setLoading(false);
  };

  const handlePageChange = (page) => {
    setPageNo(page);
  };

  const handleReferenceModalClose = () => {
    setReferenceModal(false);
    setReferenceData(null);
  };

  const handlePerRowsChange = async (newPerPage, page) => {
    setPerPage(newPerPage);
  };
  const handleFilter = (e) => {
    setFilter(e.target.value);
  };
  const col = [
    {
      name: "Sr No",
      selector: (row, index) => index + 1,
      sortable: true,
      maxWidth: "20px",
    },
    {
      name: "Role Name",
      selector: (row) => row.roleName,
      sortable: true,
      sortField: "roleName",
      minWidth: "130px",
    },
    {
      name: "Role Code",
      selector: (row) => row.roleCode,
      sortable: true,
      sortField: "roleCode",
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
              <div className="edit">
                {currentPagePermissions.edit && (
                  <button
                    className="btn btn-sm btn-soft-success btn-icon fs-14"
                    title="Edit"
                    onClick={() => handleTog_edit(row._id)}
                  >
                    <Pencil size={16} className="text-success" />
                  </button>
                )}
              </div>

              <div className="remove">
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
              {!currentPagePermissions.view && (
                <span className="text-muted">No actions available</span>
              )}
            </div>
          </React.Fragment>
        );
      },
      sortable: false,
      minWidth: "180px",
    },
  ];

  document.title = `Role Master | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Role Master"
                    filter={filter}
                    handleFilter={handleFilter}
                    tog_list={tog_list}
                    setQuery={setQuery}
                    currentPagePermissions={currentPagePermissions}
                    showAddButton={currentPagePermissions.create}
                  />
                </CardHeader>

                <CardBody>
                  <div id="customerList">
                    <div className="table-responsive table-card mt-1 mb-1 text-right">
                      <DataTable
                        columns={col}
                        data={roles}
                        progressPending={loading}
                        sortServer
                        onSort={(column, sortDirection, sortedRows) => {
                          handleSort(column, sortDirection);
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
      >
        <ModalHeader
          className="p-3 border-bottom"
          toggle={() => {
            setmodal_list(false);
            setIsSubmit(false);
          }}
        >
          Add Role
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input
                type="text"
                placeholder=" "
                required
                name="roleName"
                value={values.roleName}
                onChange={handleChange}
              />
              <Label>
                Role Name <span className="text-danger">*</span>{" "}
              </Label>
              {isSubmit && (
                <p className="text-danger">{formErrors.roleName}</p>
              )}
            </div>
            <div className="form-floating mb-3">
              <Input
                type="text"
                placeholder=" "
                required
                name="roleCode"
                value={values.roleCode}
                onChange={handleChange}
              />
              <Label>
                Role Code <span className="text-danger">*</span>{" "}
              </Label>
              {isSubmit && (
                <p className="text-danger">{formErrors.roleCode}</p>
              )}
              {values.roleCode && (
                <p className="text-muted small mb-0">
                  Employees with this role will sign in at:{" "}
                  <strong>/{slugifyPreview(values.roleCode) || "…"}</strong>
                </p>
              )}
            </div>
            <div className="form-floating mb-3">
              <textarea
                className={`form-control${isSubmit && formErrors.remark ? ' is-invalid' : ''}`}
                style={{ height: "80px" }}
                name="remark"
                value={values.remark}
                onChange={handleChange}
                placeholder=" "
                maxLength={200}
              />
              <Label>Remark</Label>
              <div className="d-flex justify-content-end">
                <small className="text-muted">{(values.remark || "").length}/200</small>
              </div>
              {isSubmit && formErrors.remark && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.remark}</p>}
            </div>
            <div className=" mb-3">
              <Input
                type="checkbox"
                className="form-check-input"
                name="isActive"
                checked={values.isActive}
onChange={handleCheck}
              />
              <Label className="form-check-label ms-1">Is Active</Label>
            </div>
          </ModalBody>
          <ModalFooter>
            <FormsFooter
              handleSubmit={handleClick}
              handleSubmitCancel={handleSubmitCancel}
              isLoading={isSubmitLoading}
            />
          </ModalFooter>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={modal_edit}
        toggle={() => {
          setmodal_edit(false);
          setIsSubmit(false);
        }}
        centered
      >
        <ModalHeader
          className="p-3 border-bottom"
          toggle={() => {
            setmodal_edit(false);
            setIsSubmit(false);
          }}
        >
          Update Role
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input
                type="text"
                placeholder=" "
                required
                name="roleName"
                value={values.roleName}
                onChange={handleChange}
              />
              <Label>
                Role Name <span className="text-danger">*</span>{" "}
              </Label>
              {isSubmit && (
                <p className="text-danger">{formErrors.roleName}</p>
              )}
            </div>
            <div className="form-floating mb-3">
              <Input
                type="text"
                placeholder=" "
                required
                name="roleCode"
                value={values.roleCode}
                onChange={handleChange}
              />
              <Label>
                Role Code <span className="text-danger">*</span>{" "}
              </Label>
              {isSubmit && (
                <p className="text-danger">{formErrors.roleCode}</p>
              )}
              {values.roleCode && (
                <p className="text-muted small mb-0">
                  Employees with this role will sign in at:{" "}
                  <strong>/{slugifyPreview(values.roleCode) || "…"}</strong>
                </p>
              )}
            </div>
            <div className="form-floating mb-3">
              <textarea
                className={`form-control${isSubmit && formErrors.remark ? ' is-invalid' : ''}`}
                style={{ height: "80px" }}
                name="remark"
                value={values.remark}
                onChange={handleChange}
                placeholder=" "
                maxLength={200}
              />
              <Label>Remark</Label>
              <div className="d-flex justify-content-end">
                <small className="text-muted">{(values.remark || "").length}/200</small>
              </div>
              {isSubmit && formErrors.remark && <p className="text-danger mb-0" style={{ fontSize: "0.75rem" }}>{formErrors.remark}</p>}
            </div>
            <div className=" mb-3">
              <Input
                type="checkbox"
                className="form-check-input"
                name="isActive"
                checked={values.isActive}
onChange={handleCheck}
              />
              <Label className="form-check-label ms-1">Is Active</Label>
            </div>
          </ModalBody>

          <ModalFooter>
            <FormUpdateFooter
              handleUpdate={handleUpdate}
              handleUpdateCancel={handleUpdateCancel}
              isLoading={isUpdateLoading || isEditFetching}
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

      <ReferenceErrorModal
        isOpen={referenceModal}
        toggle={handleReferenceModalClose}
        title="Cannot Delete Role"
        referenceData={referenceData}
      />

    </React.Fragment>
  );
};

export default RoleMaster;