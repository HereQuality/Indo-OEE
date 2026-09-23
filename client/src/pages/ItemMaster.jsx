import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateItems } from "../hooks/useItems";
import { createItem, deleteItem, getItemById, updateItem, searchItems } from "../api/items.api";
import { CYCLE_OP_FIELDS } from "../utils/productionSheet";
import NumberInput from "../Components/Production/NumberInput";

const emptyOps = () => Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, ""]));

// Total Cycle Time is the operation times' own sum — never typed separately.
// Blank when every operation box is blank, rather than showing a false "0".
const sumOps = (v) => {
  const nums = CYCLE_OP_FIELDS.map((f) => v[f.key]).filter((n) => n !== "" && n !== null && n !== undefined);
  if (!nums.length) return "";
  return nums.reduce((s, n) => s + Number(n), 0);
};

const initialState = {
  itemName: "",
  drawingNo: "",
  setupNo: "",
  totalCycleSec: "",
  ...emptyOps(),
  isActive: true,
};

const ItemMaster = () => {
  const toast = useAlert();
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

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
    getItemById(id)
      .then((res) => {
        const it = res.data.data;
        setValues({
          itemName: it.itemName,
          drawingNo: it.drawingNo || "",
          setupNo: it.setupNo || "",
          totalCycleSec: it.totalCycleSec ?? "",
          ...Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, it[f.key] ?? ""])),
          isActive: it.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch part details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => {
      const next = { ...v, [name]: value };
      // Total Cycle Time is derived from the operation boxes, so any of
      // their changes recompute it — it's never typed on its own.
      if (CYCLE_OP_FIELDS.some((f) => f.key === name)) next.totalCycleSec = sumOps(next);
      return next;
    });
  };

  const validate = (v) => {
    const errors = {};
    if (!v.itemName.trim()) errors.itemName = "Part Name is required!";
    if (CYCLE_OP_FIELDS.some((f) => v[f.key] !== "" && (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0))) {
      errors.cycleOps = "Cycle times must be 0 or more";
    }
    return errors;
  };

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    const data = {
      ...values,
      itemName: values.itemName.trim(),
      drawingNo: values.drawingNo.trim(),
      setupNo: values.setupNo.trim(),
      totalCycleSec: values.totalCycleSec === "" ? null : Number(values.totalCycleSec),
      ...Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, values[f.key] === "" ? null : Number(values[f.key])])),
    };

    setIsLoading(true);
    const request = modalMode === "add" ? createItem(data) : updateItem(_id, data);
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Part Added Successfully!" : "Part Updated Successfully!");
        closeModal();
        fetchItems();
        invalidateItems();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save part. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteItem(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Part Removed Successfully!");
        fetchItems();
        invalidateItems();
      })
      .catch(() => {
        setmodal_delete(false);
        toast.error("Failed to delete part. Please try again.");
      })
      .finally(() => setIsDeleteLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchItems(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const response = await searchItems({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        isActive: !!filter,
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setItems(res?.data || []);
    } catch (error) {
      console.error("Error fetching parts:", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    { name: "Part Name", selector: (row) => row.itemName, sortable: true, sortField: "itemName", minWidth: "220px" },
    { name: "Drawing No.", selector: (row) => row.drawingNo || "", sortable: true, sortField: "drawingNo", minWidth: "120px" },
    { name: "Setup No.", selector: (row) => row.setupNo || "", sortable: true, sortField: "setupNo", minWidth: "110px" },
    { name: "Total Cycle (sec)", selector: (row) => row.totalCycleSec ?? "", sortable: true, sortField: "totalCycleSec", minWidth: "130px" },
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

  document.title = `Part Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Part"
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
                      data={items}
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

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" keyboard={false} size="lg">
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Part" : "Add Part"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input type="text" name="itemName" value={values.itemName} onChange={handleChange} placeholder=" " maxLength={120} />
              <Label>
                Part Name <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.itemName}</p>}
            </div>
            <Row>
              <Col md={6}>
                <div className="form-floating mb-3">
                  <Input type="text" name="drawingNo" value={values.drawingNo} onChange={handleChange} placeholder=" " maxLength={40} />
                  <Label>Drawing No.</Label>
                </div>
              </Col>
              <Col md={6}>
                <div className="form-floating mb-3">
                  <Input type="text" name="setupNo" value={values.setupNo} onChange={handleChange} placeholder=" " maxLength={40} />
                  <Label>Setup No.</Label>
                </div>
              </Col>
            </Row>
            <Label className="mb-2 d-block">Operation Times (sec)</Label>
            <Row className="g-2 align-items-end">
              {CYCLE_OP_FIELDS.map((f) => (
                <Col key={f.key} xs={6} md={3}>
                  <div className="form-floating">
                    <NumberInput
                      name={f.key}
                      value={values[f.key]}
                      onChange={handleChange}
                      decimals={false}
                      placeholder=" "
                    />
                    {/* Both "Other Operation" boxes carry the sheet's own label;
                        the index tells the two apart without renaming either. */}
                    <Label>{f.label.replace(" (sec)", "")}{f.key === "otherOp2Sec" ? " 2" : ""}</Label>
                  </div>
                </Col>
              ))}
            </Row>
            {isSubmit && formErrors.cycleOps && <p className="text-danger mt-1">{formErrors.cycleOps}</p>}
            {/* Never typed on its own — it's this part's operation times'
                own sum, kept in step by handleChange as soon as any of them
                changes, so it can't drift out of sync with its own inputs. */}
            <div className="form-floating mt-3">
              <NumberInput
                name="totalCycleSec"
                value={values.totalCycleSec}
                onChange={() => {}}
                decimals={false}
                placeholder=" "
                disabled
              />
              <Label>Total Cycle Time (sec) — calculated</Label>
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

export default ItemMaster;
