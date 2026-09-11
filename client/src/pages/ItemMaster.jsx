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
import { CYCLE_OPS, totalCycleSec } from "../utils/productionSheet";

const emptyOps = () => Array(CYCLE_OPS).fill("");

const initialState = {
  itemName: "",
  drawingNo: "",
  setupNo: "",
  cycleOpsSec: emptyOps(),
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
        const ops = emptyOps().map((_, i) => it.cycleOpsSec?.[i] ?? "");
        setValues({
          itemName: it.itemName,
          drawingNo: it.drawingNo || "",
          setupNo: it.setupNo || "",
          cycleOpsSec: ops,
          isActive: it.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch item details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const handleChange = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  const handleOpChange = (index, value) => {
    const ops = [...values.cycleOpsSec];
    ops[index] = value;
    setValues({ ...values, cycleOpsSec: ops });
  };

  const validate = (v) => {
    const errors = {};
    if (!v.itemName.trim()) errors.itemName = "Item Name is required!";
    if (v.cycleOpsSec.some((op) => op !== "" && (!Number.isFinite(Number(op)) || Number(op) < 0))) {
      errors.cycleOpsSec = "Cycle times must be positive numbers";
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
      cycleOpsSec: values.cycleOpsSec.map((op) => (op === "" ? null : Number(op))),
    };

    setIsLoading(true);
    const request = modalMode === "add" ? createItem(data) : updateItem(_id, data);
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Item Added Successfully!" : "Item Updated Successfully!");
        closeModal();
        fetchItems();
        invalidateItems();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save item. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteItem(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Item Removed Successfully!");
        fetchItems();
        invalidateItems();
      })
      .catch(() => {
        setmodal_delete(false);
        toast.error("Failed to delete item. Please try again.");
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
      console.error("Error fetching items:", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const col = [
    { name: "Sr No", selector: (row, index) => index + 1, maxWidth: "20px" },
    { name: "Item Name", selector: (row) => row.itemName, sortable: true, sortField: "itemName", minWidth: "220px" },
    { name: "Drawing No.", selector: (row) => row.drawingNo || "", sortable: true, sortField: "drawingNo", minWidth: "120px" },
    { name: "Setup No.", selector: (row) => row.setupNo || "", sortable: true, sortField: "setupNo", minWidth: "110px" },
    {
      name: "Cycle Times (sec)",
      selector: (row) => (row.cycleOpsSec || []).map((v) => (v === null || v === undefined ? "–" : v)).join(" + "),
      minWidth: "170px",
    },
    { name: "Total Cycle (sec)", selector: (row) => totalCycleSec(row.cycleOpsSec) ?? "", minWidth: "130px" },
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

  const total = totalCycleSec(values.cycleOpsSec);

  document.title = `Item Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Items"
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
          {modalMode === "edit" ? "Update Item" : "Add Item"}
        </ModalHeader>
        <form noValidate>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input type="text" name="itemName" value={values.itemName} onChange={handleChange} placeholder=" " maxLength={120} />
              <Label>
                Item Name <span className="text-danger">*</span>
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
            <Label className="mb-2 d-block">Cycle Time (sec)</Label>
            <Row className="g-2 align-items-end">
              {values.cycleOpsSec.map((op, i) => (
                <Col key={i} xs={4} md={2}>
                  <div className="form-floating">
                    <Input type="number" min="0" value={op} onChange={(e) => handleOpChange(i, e.target.value)} placeholder=" " />
                    <Label>Op {i + 1}</Label>
                  </div>
                </Col>
              ))}
              <Col xs={4} md={2}>
                <div className="form-floating">
                  <Input type="text" value={total ?? ""} readOnly disabled placeholder=" " />
                  <Label>Total</Label>
                </div>
              </Col>
            </Row>
            {isSubmit && formErrors.cycleOpsSec && <p className="text-danger mt-1">{formErrors.cycleOpsSec}</p>}
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
