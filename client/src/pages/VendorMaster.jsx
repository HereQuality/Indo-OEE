import React, { useState, useEffect, useContext, useMemo } from "react";
import { Pencil, Trash2 } from "lucide-react";
import Select from "react-select";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateVendors } from "../hooks/useVendors";
import { useProcesses } from "../hooks/useProcesses";
import { createVendor, deleteVendor, getVendorById, updateVendor, searchVendors } from "../api/vendors.api";

/**
 * pages/VendorMaster.jsx
 * ────────────────────────────
 * The vendor list behind the entry forms' type-to-search "Vendor Name" box —
 * a name, the processes it is used in, and an active flag, on its own Vendor
 * model. Built from Operator Master. A process's entry form shows the Vendor
 * Name box only while at least one active vendor is selected for it here, and
 * offers just those vendors.
 */
const initialState = { name: "", processes: [], isActive: true };

const VendorMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [vendors, setVendors] = useState([]);
  const { data: processes = [] } = useProcesses();
  // Inactive processes aren't offered, but one this vendor already has stays
  // listed so editing it never silently drops it.
  const processOptions = useMemo(
    () =>
      processes
        .filter((p) => p.isActive !== false || values.processes.includes(p._id))
        .map((p) => ({ value: p._id, label: p.processName })),
    [processes, values.processes],
  );
  const invalidateVendors = useInvalidateVendors();
  const [query, setQuery] = useState("");

  const [_id, set_Id] = useState("");
  const [remove_id, setRemove_id] = useState("");

  // null = closed, "add" or "edit"
  const [modalMode, setModalMode] = useState(null);
  const [modal_delete, setmodal_delete] = useState(false);

  const [loading, setLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [column, setcolumn] = useState();
  const [sortDirection, setsortDirection] = useState();
  const perPage = 100;

  const closeModal = () => {
    setModalMode(null);
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
  };

  const openAdd = () => {
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
    setModalMode("add");
  };

  const openEdit = (id) => {
    set_Id(id);
    setIsSubmit(false);
    setFormErrors({});
    setModalMode("edit");
    setIsLoading(true);
    getVendorById(id)
      .then((res) => {
        const v = res.data.data;
        setValues({ name: v.name || "", processes: (v.processes || []).map((p) => String(p._id || p)), isActive: v.isActive });
      })
      .catch(() => toast.error("Failed to fetch vendor details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  const validate = (v) => {
    const errors = {};
    if (!v.name.trim()) errors.name = "Vendor name is required!";
    if (!v.processes.length) errors.processes = "Select at least one process";
    return errors;
  };

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    const data = { ...values, name: values.name.trim() };

    setIsLoading(true);
    const request = modalMode === "add" ? createVendor(data) : updateVendor(_id, data);
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Vendor Added Successfully!" : "Vendor Updated Successfully!");
        closeModal();
        fetchVendors();
        invalidateVendors();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save vendor. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteVendor(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Vendor Removed Successfully!");
        fetchVendors();
        invalidateVendors();
      })
      .catch(() => {
        setmodal_delete(false);
        toast.error("Failed to delete vendor. Please try again.");
      })
      .finally(() => setIsDeleteLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchVendors(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter]);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const response = await searchVendors({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: !!filter,
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setVendors(res?.data || []);
    } catch (error) {
      console.error("Error fetching vendors:", error);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  };

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    { name: "Vendor Name", selector: (row) => row.name, sortable: true, sortField: "name", minWidth: "260px" },
    {
      name: "Process",
      cell: (row) =>
        row.processes?.length ? (
          <div className="d-flex flex-wrap gap-1 py-1">
            {row.processes.map((p) => (
              <span key={p._id} className="badge bg-primary-subtle text-primary">{p.processName}</span>
            ))}
          </div>
        ) : (
          <span className="text-muted small">None — not shown on any entry form</span>
        ),
      minWidth: "220px",
    },
    { name: "Status", selector: (row) => (row.isActive ? "Active" : "Inactive"), minWidth: "100px" },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex gap-2">
          {currentPagePermissions.edit && (
            <button className="btn btn-sm btn-soft-success btn-icon fs-14" title="Edit" onClick={() => openEdit(row._id)}>
              <Pencil size={16} className="text-success" />
            </button>
          )}
          {currentPagePermissions.delete && (
            <button className="btn btn-sm btn-soft-danger btn-icon fs-14" title="Remove" onClick={() => tog_delete(row._id)}>
              <Trash2 size={16} className="text-danger" />
            </button>
          )}
        </div>
      ),
      minWidth: "140px",
    },
  ];

  document.title = `Vendor Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Vendors"
                    filter={filter}
                    handleFilter={(e) => {
                      setPageNo(1);
                      setFilter(e.target.checked);
                    }}
                    tog_list={openAdd}
                    setQuery={setQuery}
                    showAddButton={currentPagePermissions.create}
                  />
                </CardHeader>
                <CardBody>
                  <div className="table-responsive table-card mt-1 mb-1 text-right">
                    <DataTable
                      columns={col}
                      data={vendors}
                      progressPending={loading}
                      sortServer
                      onSort={(c, dir) => {
                        setcolumn(c.sortField);
                        setsortDirection(dir);
                      }}
                      pagination
                      paginationServer
                      paginationComponentOptions={{ noRowsPerPage: true }}
                      paginationTotalRows={totalRows}
                      paginationPerPage={perPage}
                      onChangePage={setPageNo}
                    />
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" size="md">
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Vendor" : "Add Vendor"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input type="text" name="name" value={values.name} onChange={handleChange} placeholder=" " maxLength={100} />
              <Label>
                Vendor Name <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.name}</p>}
            </div>
            <div className="mb-3">
              <Label className="fw-semibold mb-1 d-block">
                Process <span className="text-danger">*</span>
              </Label>
              <Select
                isMulti
                classNamePrefix="select"
                options={processOptions}
                value={processOptions.filter((o) => values.processes.includes(o.value))}
                onChange={(picked) => {
                  const next = { ...values, processes: (picked || []).map((o) => o.value) };
                  setValues(next);
                  // Once Save has flagged it, the message goes as soon as a process is picked.
                  if (isSubmit) setFormErrors(validate(next));
                }}
                placeholder="Select processes…"
                noOptionsMessage={() => (processes.length ? "No more processes" : "No processes — add them in Production › Processes")}
                closeMenuOnSelect={false}
                styles={{ control: (base) => (isSubmit && formErrors.processes ? { ...base, borderColor: "#dc3545" } : base) }}
              />
              <div className="text-muted small mt-1">
                Only the selected processes show the Vendor Name box on their entry form, and offer this vendor in it.
              </div>
              {isSubmit && formErrors.processes && <p className="text-danger small mb-0 mt-1">{formErrors.processes}</p>}
            </div>
            <div className="mt-3">
              <Input
                type="checkbox"
                className="form-check-input"
                name="isActive"
                checked={values.isActive}
                onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
              />
              <Label className="form-check-label ms-1">Is Active</Label>
            </div>
          </ModalBody>
          <ModalFooter>
            {modalMode === "edit" ? (
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={closeModal} isLoading={isLoading} />
            ) : (
              <FormsFooter handleSubmit={handleSave} handleSubmitCancel={closeModal} isLoading={isLoading} />
            )}
          </ModalFooter>
        </form>
      </Modal>

      <DeleteModal
        show={modal_delete}
        handleDelete={handleDelete}
        toggle={(e) => {
          e?.preventDefault?.();
          setmodal_delete(false);
        }}
        setmodal_delete={setmodal_delete}
        disabled={isDeleteLoading}
      />
    </React.Fragment>
  );
};

export default VendorMaster;
