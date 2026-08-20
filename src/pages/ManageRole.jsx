import React, { useState, useEffect, useContext, useMemo } from "react";
import {
  Container,
  Row,
  Col,
  Card,
  CardHeader,
  CardBody,
  Input,
  Label,
  Table,
  Button,
  FormGroup,
  Spinner,
  Badge,
  Alert
} from "reactstrap";
import Select from "react-select";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { ThemeContext } from "../context/ThemeContext";
import { useRoles } from "../hooks/useRoles";
import { getMenusByGroups } from "../api/menus.api";
import { getEmployeeRolesByRoleId, createEmployeeRoles, updateEmployeeRoles } from "../api/employeeRoles.api";

// 4-flag RBAC model:
//   view   → can see/open the page
//   create → can add new records
//   edit   → can update/edit existing records
//   delete → can remove records
// Rule: create/edit/delete require view. Unchecking view auto-clears all.

const FLAGS = ["view", "create", "edit", "delete"];

const EmployeeRoles = () => {
  const toast = useAlert();
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const { data: rawRoles = [], isLoading: rolesLoading } = useRoles({
    onError: () => toast.error("Failed to load roles"),
  });
  const roles = useMemo(
    () => rawRoles.map((role) => ({ value: role._id, label: role.roleName })),
    [rawRoles]
  );
  const [selectedRole, setSelectedRole] = useState(null);
  const [menuData, setMenuData] = useState([]);
  const [employeeRoles, setEmployeeRoles] = useState(null);
  const [rolesChanged, setRolesChanged] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);

  const { menuData: contextMenuData, currentPagePermissions } = useContext(MenuContext);
  const { isDarkMode } = useContext(ThemeContext);
  const canWrite = !!(currentPagePermissions?.create || currentPagePermissions?.edit || currentPagePermissions?.delete);

  useEffect(() => { fetchAllMenuData(); }, []);
  useEffect(() => {
    if (selectedRole) fetchEmployeeRoles(selectedRole.value);
    else setEmployeeRoles(null);
  }, [selectedRole]);

  const fetchAllMenuData = async () => {
    setLoading(true);
    try {
      const response = await getMenusByGroups();
      if (response.data.isOk) {
        const data = response.data.data;
        if (Array.isArray(data)) setMenuData(data);
        else toast.error("Menu data is in an unexpected format");
      } else {
        toast.error("Failed to load menu data");
        if (contextMenuData?.length > 0) setMenuData(contextMenuData);
      }
    } catch (error) {
      toast.error("Failed to load menus and menu groups");
      if (contextMenuData?.length > 0) setMenuData(contextMenuData);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployeeRoles = async (roleId) => {
    setLoading(true);
    try {
      const response = await getEmployeeRolesByRoleId(roleId);
      if (response.data.data?.length > 0) setEmployeeRoles(response.data.data[0]);
      else setEmployeeRoles(null);
    } catch (error) {
      if (error.response?.status === 404) setEmployeeRoles(null);
      else toast.error("Failed to load employee roles");
    } finally {
      setLoading(false);
      setRolesChanged(false);
    }
  };

  // Get the permission object for a menu/group id
  const getRole = (id, isGroup) => {
    if (!employeeRoles?.roles) return null;
    return employeeRoles.roles.find((r) =>
      isGroup ? r.menuGroupId === id : r.menuId === id
    ) || null;
  };

  const hasPermission = (id, isGroup, flag) => {
    const role = getRole(id, isGroup);
    return role ? !!role[flag] : false;
  };

  const hasAllPermissions = (id, isGroup) => {
    const role = getRole(id, isGroup);
    return !!(role && FLAGS.every((f) => role[f]));
  };

  const hasAnyPermissions = (id, isGroup) => {
    const role = getRole(id, isGroup);
    return !!(role && FLAGS.some((f) => role[f]));
  };

  const hasColumnAllPermissions = (flag) => {
    if (!employeeRoles?.roles) return false;
    const allIds = [];
    menuData.forEach((group) => {
      if (group.isLink) allIds.push({ id: group.groupId, isGroup: true });
      else if (group.menus) {
        const collect = (menus) => menus.forEach((menu) => {
          allIds.push({ id: menu.id, isGroup: false });
          if (menu.children?.length > 0) collect(menu.children);
        });
        collect(group.menus);
      }
    });
    if (!allIds.length) return false;
    return allIds.every(({ id, isGroup }) => hasPermission(id, isGroup, flag));
  };

  const hasGroupAllPermissions = (groupId) => {
    if (!employeeRoles?.roles) return false;
    const group = menuData.find((g) => g.groupId === groupId);
    if (!group) return false;
    if (group.isLink) {
      const role = getRole(groupId, true);
      return !!(role && FLAGS.every((f) => role[f]));
    }
    if (group.menus) {
      const checkAll = (menus) => menus.every((menu) => {
        const role = getRole(menu.id, false);
        const ok = !!(role && FLAGS.every((f) => role[f]));
        return ok && (!menu.children?.length || checkAll(menu.children));
      });
      return checkAll(group.menus);
    }
    return false;
  };

  const hasGroupAnyPermissions = (groupId) => {
    if (!employeeRoles?.roles) return false;
    const group = menuData.find((g) => g.groupId === groupId);
    if (!group) return false;
    if (group.isLink) return hasAnyPermissions(groupId, true);
    if (group.menus) {
      const checkAny = (menus) => menus.some((menu) => {
        const role = getRole(menu.id, false);
        const any = !!(role && FLAGS.some((f) => role[f]));
        return any || (menu.children?.length > 0 && checkAny(menu.children));
      });
      return checkAny(group.menus);
    }
    return false;
  };

  // Core update helper
  const applyPermission = (prevRoles, menuField, id, updates) => {
    const updatedRoles = { ...prevRoles, roles: [...(prevRoles?.roles || [])] };
    const idx = updatedRoles.roles.findIndex((r) =>
      menuField === "menuGroupId" ? r.menuGroupId === id : r.menuId === id
    );
    if (idx === -1) {
      updatedRoles.roles.push({ [menuField]: id, view: false, create: false, edit: false, delete: false, ...updates });
    } else {
      updatedRoles.roles[idx] = { ...updatedRoles.roles[idx], ...updates };
    }
    return updatedRoles;
  };

  const ensureBase = () => ({
    roleId: selectedRole.value,
    roles: [],
    ...(employeeRoles || {}),
  });

  // Toggle a single flag on one menu/group
  const handlePermissionChange = (id, isGroup, flag, isChecked) => {
    setRolesChanged(true);
    const menuField = isGroup ? "menuGroupId" : "menuId";
    let updates = { [flag]: isChecked };

    // Unchecking view → clear all others
    if (flag === "view" && !isChecked) {
      updates = { view: false, create: false, edit: false, delete: false };
    }
    // Checking create/edit/delete → auto-enable view
    if (flag !== "view" && isChecked) {
      updates.view = true;
    }

    setEmployeeRoles(applyPermission(ensureBase(), menuField, id, updates));
  };

  // Toggle all 4 flags for one row
  const handleAllPermissions = (id, isGroup, isChecked) => {
    setRolesChanged(true);
    const menuField = isGroup ? "menuGroupId" : "menuId";
    const updates = FLAGS.reduce((a, f) => ({ ...a, [f]: isChecked }), {});
    setEmployeeRoles(applyPermission(ensureBase(), menuField, id, updates));
  };

  // Toggle a full column across all menus/groups
  const handleColumnPermissionChange = (flag, isChecked) => {
    setRolesChanged(true);
    let base = ensureBase();

    menuData.forEach((group) => {
      if (group.isLink) {
        let updates = { [flag]: isChecked };
        if (flag === "view" && !isChecked) updates = { view: false, create: false, edit: false, delete: false };
        if (flag !== "view" && isChecked) updates.view = true;
        base = applyPermission(base, "menuGroupId", group.groupId, updates);
      } else if (group.menus) {
        const apply = (menus) => menus.forEach((menu) => {
          let updates = { [flag]: isChecked };
          if (flag === "view" && !isChecked) updates = { view: false, create: false, edit: false, delete: false };
          if (flag !== "view" && isChecked) updates.view = true;
          base = applyPermission(base, "menuId", menu.id, updates);
          if (menu.children?.length > 0) apply(menu.children);
        });
        apply(group.menus);
      }
    });
    setEmployeeRoles(base);
  };

  // Toggle all 4 flags for every menu inside a group header
  const handleAllGroupPermissions = (groupId, isChecked) => {
    setRolesChanged(true);
    let base = ensureBase();
    const group = menuData.find((g) => g.groupId === groupId);
    if (!group) return;

    if (group.isLink) {
      base = applyPermission(base, "menuGroupId", groupId, FLAGS.reduce((a, f) => ({ ...a, [f]: isChecked }), {}));
    } else if (group.menus) {
      const apply = (menus) => menus.forEach((menu) => {
        base = applyPermission(base, "menuId", menu.id, FLAGS.reduce((a, f) => ({ ...a, [f]: isChecked }), {}));
        if (menu.children?.length > 0) apply(menu.children);
      });
      apply(group.menus);
    }
    setEmployeeRoles(base);
  };

  const saveEmployeeRoles = async () => {
    if (!selectedRole) return;
    const payload = { roleId: selectedRole.value, roles: employeeRoles ? employeeRoles.roles : [] };
    setSaveLoading(true);
    try {
      if (employeeRoles?._id) {
        await updateEmployeeRoles(selectedRole.value, payload);
        toast.success("Roles updated successfully");
      } else {
        await createEmployeeRoles(payload);
        toast.success("Roles created successfully");
      }
      fetchEmployeeRoles(selectedRole.value);
    } catch (error) {
      const msg = error?.response?.data?.message || "Failed to save roles";
      if (error?.response?.status === 400 && msg.includes("already exist")) {
        try {
          await updateEmployeeRoles(selectedRole.value, payload);
          toast.success("Roles updated successfully");
          fetchEmployeeRoles(selectedRole.value);
        } catch { toast.error("Failed to save roles"); }
      } else { toast.error(msg); }
    } finally { setSaveLoading(false); }
  };

  const clearAllPermissions = async () => {
    if (!selectedRole) return;
    setSaveLoading(true);
    try {
      if (employeeRoles?._id) {
        await updateEmployeeRoles(selectedRole.value, { roleId: selectedRole.value, roles: [] });
        toast.success("All permissions cleared");
      } else { toast.info("No permissions to clear"); }
      fetchEmployeeRoles(selectedRole.value);
    } catch { toast.error("Failed to clear permissions"); }
    finally { setSaveLoading(false); }
  };

  const getRowStyles = (id, isGroup) => {
    const hasAny = hasAnyPermissions(id, isGroup);
    const isHovered = hoveredRow === id;
    let bg = "";
    if (isHovered) bg = isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,123,255,0.05)";
    else if (hasAny) bg = isDarkMode ? "rgba(40,167,69,0.15)" : "rgba(40,167,69,0.05)";
    return { backgroundColor: bg, transition: "background-color 0.2s" };
  };

  const FlagCheckbox = ({ id, isGroup, flag, disabled }) => {
    return (
      <Input
        type="checkbox"
        checked={hasPermission(id, isGroup, flag)}
        onChange={(e) => handlePermissionChange(id, isGroup, flag, e.target.checked)}
        className="permission-checkbox"
        disabled={disabled}
        style={{ width: 16, height: 16, cursor: disabled ? "not-allowed" : "pointer" }}
      />
    );
  };

  const renderMenuItems = (menuItems, depth = 0) => {
    if (!menuItems?.length) return null;
    return menuItems.map((menu) => (
      <React.Fragment key={menu.id}>
        <tr
          style={getRowStyles(menu.id, false)}
          onMouseEnter={() => setHoveredRow(menu.id)}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <td style={{ paddingLeft: `${depth * 2}rem` }} className="menu-name-cell">
            {depth > 0 && <i className="bx bx-subdirectory-right me-2 text-muted" />}
            <span className={depth === 0 && menu.isParent ? "fw-bold" : ""}>
              {menu.isParent
                ? <i className="bx bx-folder me-1 text-primary" />
                : <i className="bx bx-file me-1 text-info" />}
              {menu.name}
            </span>
            {hasAllPermissions(menu.id, false) && (
              <Badge color="success" className="ms-2" pill>All</Badge>
            )}
            <div className="float-end">
              <Button color="light" size="sm" className="btn-sm py-0 px-1"
                onClick={() => handleAllPermissions(menu.id, false, !hasAllPermissions(menu.id, false))}
                title={hasAllPermissions(menu.id, false) ? "Revoke all" : "Grant all"}>
                {hasAllPermissions(menu.id, false)
                  ? <i className="bx bx-x text-danger" />
                  : <i className="bx bx-check text-success" />}
              </Button>
            </div>
          </td>
          {FLAGS.map((flag) => (
            <td key={flag} className="text-center permission-cell">
              <FlagCheckbox id={menu.id} isGroup={false} flag={flag} disabled={!canWrite} />
            </td>
          ))}
        </tr>
        {menu.children?.length > 0 && renderMenuItems(menu.children, depth + 1)}
      </React.Fragment>
    ));
  };

  document.title = `Employee Roles | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  const colWidth = { menu: "48%", flag: "13%" };

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Card className="shadow-sm">
            <CardHeader className="bg-light d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                <i className="bx bx-user-circle me-2 text-primary" />Role Management
              </h5>
              {(!menuData || menuData.length === 0) && (
                <Button color="secondary" size="sm" onClick={fetchAllMenuData}>
                  <i className="bx bx-refresh me-1" />Reload Menus
                </Button>
              )}
            </CardHeader>
            <CardBody>
              <Row className="mb-4">
                <Col md={3}>
                  <FormGroup>
                    <Label htmlFor="employeeSelect" className="fw-bold">
                      <i className="bx bx-user me-1" /> Select Role
                    </Label>
                    <Select
                      id="employeeSelect"
                      options={roles}
                      value={selectedRole}
                      onChange={setSelectedRole}
                      className="basic-single"
                      classNamePrefix="select"
                      placeholder="Select a role..."
                      isDisabled={loading || rolesLoading}
                      isClearable
                    />
                  </FormGroup>
                </Col>
                <Col md={9} className="d-flex align-items-end justify-content-end gap-2 flex-wrap">
                  {rolesChanged && selectedRole && (
                    <span className="text-warning fw-bold d-flex align-items-center me-2" style={{ fontSize: '0.9rem' }}>
                      <i className="bx bx-error-circle me-1" /> Unsaved changes
                    </span>
                  )}
                  {!canWrite && (
                    <span className="badge bg-warning-subtle text-warning border border-warning-subtle px-3 py-2">
                      <i className="bx bx-lock-alt me-1" />Read Only
                    </span>
                  )}
                  {selectedRole && canWrite && employeeRoles?._id && (
                    <Button color="danger" outline size="sm" onClick={clearAllPermissions} disabled={saveLoading}>
                      <i className="bx bx-trash me-1" />Clear All
                    </Button>
                  )}
                  {selectedRole && canWrite && (
                    <Button color="primary" onClick={saveEmployeeRoles} disabled={saveLoading || !rolesChanged}>
                      {saveLoading
                        ? <><Spinner size="sm" className="me-1" /> Saving...</>
                        : <><i className="bx bx-save me-1" /> Save Roles</>}
                    </Button>
                  )}
                </Col>
              </Row>

              <div className="text-muted small mb-2 d-flex align-items-center">
                <i className="bx bx-info-circle me-1" />
                <span>
                  <strong>View</strong> = open page &nbsp;&middot;&nbsp; 
                  <strong>Create</strong> = add records &nbsp;&middot;&nbsp; 
                  <strong>Edit</strong> = update records &nbsp;&middot;&nbsp; 
                  <strong>Delete</strong> = remove records
                </span>
              </div>

              {selectedRole ? (
                <div className="mt-4 menu-roles-table-container">
                  <div className="table-responsive">
                    <Table bordered hover className="menu-roles-table">
                      <thead>
                        <tr className="bg-light">
                          <th style={{ width: colWidth.menu, position: "sticky", top: 0, zIndex: 10, backgroundColor: "#f8f9fa" }}>Menu</th>
                          {FLAGS.map((flag) => (
                            <th key={flag} style={{ width: colWidth.flag, position: "sticky", top: 0, zIndex: 10, backgroundColor: "#f8f9fa" }} className="text-center">
                              <div className="d-flex flex-column align-items-center">
                                <span className="text-capitalize">{flag}</span>
                                <Input
                                  type="checkbox"
                                  checked={hasColumnAllPermissions(flag)}
                                  onChange={(e) => handleColumnPermissionChange(flag, e.target.checked)}
                                  className="permission-checkbox mt-1"
                                  style={{ width: 16, height: 16 }}
                                  disabled={!canWrite}
                                  title={`Toggle ${flag} for all`}
                                />
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {menuData?.length > 0 ? menuData.map((group) => (
                          <React.Fragment key={group.groupId}>
                            {/* Group Header */}
                            <tr>
                              <td colSpan={5} className="fw-bold"
                                style={{ backgroundColor: isDarkMode ? "rgba(13,110,253,0.2)" : "rgba(13,110,253,0.15)" }}>
                                <div className="d-flex align-items-center justify-content-between">
                                  <div className="d-flex align-items-center">
                                    <Input
                                      type="checkbox"
                                      checked={hasGroupAllPermissions(group.groupId)}
                                      onChange={(e) => handleAllGroupPermissions(group.groupId, e.target.checked)}
                                      className="permission-checkbox me-2"
                                      style={{ width: 16, height: 16 }}
                                      disabled={!canWrite}
                                    />
                                    <i className="bx bx-category me-2" />
                                    {group.groupName}
                                  </div>
                                  {hasGroupAnyPermissions(group.groupId) && (
                                    <Badge color="info" pill>
                                      <i className="bx bx-check me-1" />Permissions Set
                                    </Badge>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {/* Direct link group row */}
                            {group.isLink && (
                              <tr
                                style={getRowStyles(group.groupId, true)}
                                onMouseEnter={() => setHoveredRow(group.groupId)}
                                onMouseLeave={() => setHoveredRow(null)}
                              >
                                <td className="menu-name-cell">
                                  <i className="bx bx-link me-1 text-success" />{group.groupName}
                                  {hasAllPermissions(group.groupId, true) && (
                                    <Badge color="success" className="ms-2" pill>All</Badge>
                                  )}
                                  <div className="float-end">
                                    <Button color="light" size="sm" className="btn-sm py-0 px-1"
                                      onClick={() => handleAllPermissions(group.groupId, true, !hasAllPermissions(group.groupId, true))}>
                                      {hasAllPermissions(group.groupId, true)
                                        ? <i className="bx bx-x text-danger" />
                                        : <i className="bx bx-check text-success" />}
                                    </Button>
                                  </div>
                                </td>
                                {FLAGS.map((flag) => (
                                  <td key={flag} className="text-center permission-cell">
                                    <FlagCheckbox id={group.groupId} isGroup={true} flag={flag} disabled={!canWrite} />
                                  </td>
                                ))}
                              </tr>
                            )}

                            {/* Menu items */}
                            {!group.isLink && group.menus?.length > 0 && renderMenuItems(group.menus)}

                            {!group.isLink && (!group.menus || group.menus.length === 0) && (
                              <tr>
                                <td colSpan={5} className="text-center text-muted">
                                  <i className="bx bx-info-circle me-1" />
                                  <i>No menus in this group</i>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )) : (
                          <tr>
                            <td colSpan={5} className="text-center py-5">
                              <div className="text-muted">
                                <i className="bx bx-menu fs-1 d-block mb-2" />No menu data available
                              </div>
                              <Button color="primary" size="sm" className="mt-2" onClick={fetchAllMenuData}>
                                <i className="bx bx-refresh me-1" />Reload Menus
                              </Button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </div>
                  {menuData?.length > 0 && (
                    <div className="text-center text-muted small mt-3">
                      <i className="bx bx-bulb me-1" />
                      Tip: Use column headers to toggle all, group headers for a group, or individual checkboxes for specific permissions.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-5 my-4 border rounded bg-light">
                  <div className="avatar-lg mx-auto mb-4">
                    <div className="avatar-title bg-white text-primary display-5 rounded-circle shadow-sm">
                      <i className="bx bx-user-circle" />
                    </div>
                  </div>
                  <h5>Select a Role</h5>
                  <p className="text-muted">Please select a role from the dropdown above to manage its permissions</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Container>
      </div>

      <style>{`
        .menu-roles-table th, .menu-roles-table td { vertical-align: middle; }
        .menu-name-cell { position: relative; }
        .permission-cell { width: 90px; text-align: center; }
        .permission-checkbox { cursor: pointer; width: 18px; height: 18px; }
        .table-responsive { max-height: calc(100vh - 300px); overflow-y: auto; }
      `}</style>
    </React.Fragment>
  );
};

export default EmployeeRoles;
