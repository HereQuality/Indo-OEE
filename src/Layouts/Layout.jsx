import React, { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { NavLink, Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useCompany } from '../hooks/useCompany';
import { MenuContext } from '../context/MenuContext';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import { toRolePath } from '../utils/roleUrl';
import { logout, setCookie } from '../api/auth.api';
import ConfirmAlert from '../Components/Common/ConfirmAlert';
import { Tooltip, tooltipClasses } from "@mui/material";
import DynamicIcon from '../Components/Common/DynamicIcon';
import NotificationBell from '../Components/Common/NotificationBell';
import { useSocket } from '../context/SocketContext';
import { getUnreadTicketCount } from '../api/tickets.api';

// One layout for every role (SuperAdmin / Employee) — there is no separate
// "AdminLayout" anymore. The sidebar itself is already fully dynamic
// (comes from MenuContext, scoped server-side per role — see
// server/controllers/menuMaster.controller.js). This is a single-tenant
// deployment (one codebase per client), so branding is just this app's own
// static name/logo for everyone — set VITE_APP_NAME per deployment if you
// want each client's copy to show their own name.
const DEFAULT_APP_NAME = import.meta.env.VITE_APP_NAME || "Inventory Hub";
const API_URL = import.meta.env.VITE_API_BASE_URL;

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  // The role's own URL segment, e.g. "manager" for /manager/dashboard, or
  // "hqepl" for SuperAdmin. RoleRoute has already confirmed this matches
  // the logged-in user's role before this layout ever renders.
  const { roleSlug } = useParams();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const { socket, connected } = useSocket();
  const [unreadTicketCount, setUnreadTicketCount] = useState(0);
  // Desktop sidebar collapse (icon-only rail) — separate from the mobile
  // overlay above. Persisted so it stays collapsed across page loads.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("sidebarCollapsed") === "true"
  );
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const { menuData: menus, loading } = useContext(MenuContext);
  const { adminData } = useContext(AuthContext);
  const { isDarkMode, toggleTheme } = useContext(ThemeContext);
  const dropdownRef = useRef(null);
  const [openGroups, setOpenGroups] = useState({});

  const { data: companyDetails } = useCompany();
  const APP_NAME = companyDetails?.name || DEFAULT_APP_NAME;
  const logo = companyDetails?.logo ? companyDetails.logo : null; // fallback to text or default if needed

  const isSuperAdmin = adminData?.roleType === 'SuperAdmin';

  const displayName = adminData?.name || adminData?.employeeName || "User";
  const roleLabel = isSuperAdmin
    ? "Super Admin"
    : (adminData?.roleName || adminData?.roleType || "Employee");
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Compute the current page title from menu data dynamically
  const currentPageTitle = useMemo(() => {
    if (!menus) return isSuperAdmin ? 'HQEPL Dashboard' : 'Dashboard';
    const path = location.pathname;
    // Strip the role-slug prefix from path for comparison
    const stripSlug = (p) => p.replace(/^\/[^/]+/, '');
    const cleanPath = stripSlug(path);
    for (const group of menus) {
      if (group.isLink && group.url && stripSlug(group.url) === cleanPath) return group.groupName;
      for (const menu of (group.menus || [])) {
        if (menu.url && stripSlug(menu.url) === cleanPath) return menu.name || menu.menuName;
      }
    }
    // Fallback: humanize last path segment
    const seg = path.split('/').filter(Boolean).pop() || 'Dashboard';
    return seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }, [menus, location.pathname, isSuperAdmin]);

  // A group should default to open if the current page lives inside it,
  // so navigating straight to a child page (e.g. via a bookmark or refresh)
  // doesn't leave its parent group looking collapsed/empty.
  const groupContainsCurrentPath = (group) =>
    group.menus?.some((menu) => location.pathname.startsWith(toRolePath(menu.url, roleSlug))) || false;

  const isGroupOpen = (group) => {
    if (sidebarCollapsed) return false;
    return openGroups[group.groupId] !== undefined
      ? openGroups[group.groupId]
      : groupContainsCurrentPath(group);
  };

  const toggleGroup = (groupId, currentlyOpen) => {
    // Accordion: opening one group closes all others
    setOpenGroups(currentlyOpen ? {} : { [groupId]: true });
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // State for logout alert
  const [logoutAlertOpen, setLogoutAlertOpen] = useState(false);

  // Sidebar "Support" red-dot — same unread definition Support.jsx itself
  // uses (getUnreadTicketCount is already scoped server-side to whatever
  // this person is allowed to see), kept live via the shared socket so it
  // updates the moment a new message/ticket comes in without a refresh.
  useEffect(() => {
    getUnreadTicketCount()
      .then((res) => setUnreadTicketCount(res?.data?.unreadCount || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket || !connected) return undefined;
    const onRefresh = () => {
      getUnreadTicketCount()
        .then((res) => setUnreadTicketCount(res?.data?.unreadCount || 0))
        .catch(() => {});
    };
    socket.on("refresh_unread_count", onRefresh);
    return () => socket.off("refresh_unread_count", onRefresh);
  }, [socket, connected]);

  const handleLogout = () => {
    setLogoutAlertOpen(true);
  };

  const confirmLogout = () => {
    setLogoutAlertOpen(false);
    logout(); // clears cookie, localStorage, sessionStorage, redirects to /
  };

  return (
    <div spellCheck={false} className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      <ConfirmAlert
        isOpen={logoutAlertOpen}
        variant="danger"
        title="Sign Out"
        message="Are you sure you want to sign out of your account?"
        confirmText="Yes, Sign Out"
        cancelText="Cancel"
        onCancel={() => setLogoutAlertOpen(false)}
        onConfirm={confirmLogout}
      />

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          background: isDarkMode ? '#0f0f0f' : '#ffffff',
          borderRight: isDarkMode ? '1px solid #272727' : '1px solid #e2e8f0',
          boxShadow: isDarkMode ? 'none' : '1px 0 6px rgba(15, 23, 42, 0.08)',
          color: isDarkMode ? '#f1f1f1' : '#1e293b',
        }}
        className={`fixed inset-y-0 left-0 flex flex-col z-50 transform transition-all duration-300 ease-in-out md:relative md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'} ${sidebarCollapsed ? 'md:w-[72px] w-64' : 'w-64'}`}
      >
        {/* Logo header */}
        <div
          style={{
            borderBottom: isDarkMode ? '1px solid #272727' : '1px solid #e2e8f0',
            background: isDarkMode ? '#0f0f0f' : '#ffffff',
          }}
          className={`h-16 flex items-center ${sidebarCollapsed ? 'md:justify-center md:px-2 px-6 justify-between' : 'px-6 justify-between'}`}
        >
          <Link to={adminData?.roleType === "SuperAdmin" ? `/hqepl/hqepl-dashboard` : `/${roleSlug}/home`} className="flex items-center justify-center w-full min-w-0">
            {logo ? (
              <img src={logo} alt={APP_NAME} className="h-12 w-auto shrink-0" />
            ) : (
              <span style={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }} className="font-bold text-lg truncate px-2">{APP_NAME}</span>
            )}
          </Link>
          <button
            style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
            className="md:hidden hover:opacity-80"
            onClick={() => setMobileMenuOpen(false)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Desktop-only collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            background: isDarkMode ? '#374151' : '#2563eb',
            border: isDarkMode ? '1px solid #4b5563' : '1px solid #93c5fd',
            color: '#ffffff',
          }}
          className="hidden md:flex absolute -right-3 top-[52px] h-6 w-6 rounded-full shadow-md items-center justify-center hover:scale-110 transition-all z-10"
        >
          <svg className={`w-3 h-3 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          {loading ? (
            <div className="flex justify-center p-4">
              <div
                style={{ borderBottomColor: '#2563eb' }}
                className="animate-spin rounded-full h-6 w-6 border-b-2"
              />
            </div>
          ) : (
            menus && menus.map((group, groupIdx) => (
              <div
                key={group.groupId}
                style={groupIdx > 0 ? { borderTop: isDarkMode ? '1px solid #272727' : '1px solid #e2e8f0' } : undefined}
                className={`mb-2 ${groupIdx > 0 ? 'pt-2' : ''} ${sidebarCollapsed ? 'relative group/hovergroup' : ''}`}
              >
                {group.isLink ? (
                  <NavLink
                    to={toRolePath(group.url, roleSlug)}
                    title={sidebarCollapsed ? group.groupName : undefined}
                    className={`relative flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${sidebarCollapsed ? 'md:justify-center' : ''}`}
                    style={({ isActive }) => ({
                      background: isActive
                        ? (isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(37,99,235,0.09)')
                        : 'transparent',
                      color: isActive
                        ? (isDarkMode ? '#ffffff' : '#2563eb')
                        : (isDarkMode ? '#cbd5e1' : '#1e293b'),
                      fontWeight: isActive ? 600 : 500,
                    })}
                  >
                    <DynamicIcon name={group.icon} size={18} className="shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{group.groupName}</span>}
                    {group.url && group.url.replace(/\/$/, "").endsWith("/support") && unreadTicketCount > 0 && (
                      <span
                        title={`${unreadTicketCount} unread`}
                        className={sidebarCollapsed ? "absolute top-1 right-1" : "ms-auto"}
                        style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }}
                      />
                    )}
                  </NavLink>
                ) : (
                  <>
                    {/* Group header button */}
                    <button
                      type="button"
                      onClick={() => !sidebarCollapsed && toggleGroup(group.groupId, isGroupOpen(group))}
                      style={{ color: isDarkMode ? '#94a3b8' : '#334155' }}
                      className={`w-full flex items-center px-2.5 rounded-md cursor-pointer transition-colors hover:opacity-80 ${sidebarCollapsed
                          ? 'justify-center py-2.5 hover:bg-blue-50 hover:!text-blue-600'
                          : 'justify-between py-1.5 mb-1 mt-2'
                        }`}
                    >
                      {sidebarCollapsed ? (
                        // Collapsed: show icon
                        <DynamicIcon name={group.icon} defaultIcon="Folder" size={18} className="shrink-0" style={{ color: isDarkMode ? '#94a3b8' : '#334155' }} />
                      ) : (
                        // Expanded: show icon + label + chevron
                        <>
                          <div className="flex items-center gap-2">
                            <DynamicIcon name={group.icon} defaultIcon="Folder" size={14} className="shrink-0" style={{ color: isDarkMode ? '#94a3b8' : '#334155' }} />
                            <span
                              style={{ color: isDarkMode ? '#94a3b8' : '#334155' }}
                              className="text-[10px] font-extrabold uppercase tracking-[0.12em]"
                            >
                              {group.groupName}
                            </span>
                          </div>
                          <svg
                            style={{ color: isDarkMode ? '#94a3b8' : '#334155' }}
                            className={`w-3.5 h-3.5 transition-transform duration-300 ease-in-out ${isGroupOpen(group) ? 'rotate-180' : 'rotate-0'}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                          </svg>
                        </>
                      )}
                    </button>

                    {/* Expanded accordion */}
                    {!sidebarCollapsed && (
                      <div
                        className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-in-out"
                        style={{ gridTemplateRows: isGroupOpen(group) ? '1fr' : '0fr' }}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className={`space-y-0.5 pt-0.5 pb-0.5 transition-opacity duration-200 ${isGroupOpen(group) ? 'opacity-100 delay-100' : 'opacity-0'}`}
                          >
                            {group.menus && group.menus.map((menu) => (
                              <NavLink
                                key={menu.id}
                                to={toRolePath(menu.url, roleSlug)}
                                className={({ isActive }) =>
                                  `relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${isActive ? 'font-semibold' : 'font-medium'}`
                                }
                                style={({ isActive }) => ({
                                  background: isActive
                                    ? (isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(37,99,235,0.09)')
                                    : 'transparent',
                                  color: isActive
                                    ? (isDarkMode ? '#ffffff' : '#2563eb')
                                    : (isDarkMode ? '#f1f5f9' : '#0f172a'),
                                })}
                              >
                                {menu.icon ? (
                                  <DynamicIcon name={menu.icon} size={16} className="shrink-0" />
                                ) : null}
                                <span className="truncate">{menu.name}</span>
                              </NavLink>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Collapsed hover popup via Tooltip */}
                    {sidebarCollapsed && group.menus && group.menus.length > 0 && (
                      <Tooltip
                        title={
                          <div className="py-1">
                            <div className="px-2 pb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-700 dark:text-slate-300">
                              {group.groupName}
                            </div>
                            <div className="flex flex-col">
                              {group.menus.map((menu) => (
                                <NavLink
                                  key={menu.id}
                                  to={toRolePath(menu.url, roleSlug)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-all rounded-lg"
                                  style={({ isActive }) => ({
                                    background: isActive
                                      ? (isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(37,99,235,0.08)')
                                      : 'transparent',
                                    color: isActive
                                      ? (isDarkMode ? '#ffffff' : '#2563eb')
                                      : (isDarkMode ? '#cbd5e1' : '#1e293b'),
                                    fontWeight: isActive ? 600 : 500,
                                  })}
                                >
                                  {menu.icon && <DynamicIcon name={menu.icon} size={15} className="shrink-0" />}
                                  <span>{menu.name}</span>
                                </NavLink>
                              ))}
                            </div>
                          </div>
                        }
                        placement="right-start"
                        slotProps={{
                          popper: {
                            sx: {
                              [`& .${tooltipClasses.tooltip}`]: {
                                backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
                                color: isDarkMode ? '#f1f1f1' : '#1e293b',
                                border: `1px solid ${isDarkMode ? '#333' : '#e2e8f0'}`,
                                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                                borderRadius: '12px',
                                padding: '8px',
                                minWidth: '180px',
                              }
                            }
                          }
                        }}
                      >
                        <div className="absolute inset-0 w-full h-full" />
                      </Tooltip>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Sign Out */}
        <div
          style={{ borderTop: isDarkMode ? '1px solid #1f2937' : '1px solid #e2e8f0' }}
          className="p-3"
        >
          <button
            onClick={handleLogout}
            title={sidebarCollapsed ? "Sign Out" : undefined}
            style={{
              background: isDarkMode ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.04)',
              border: isDarkMode ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(239,68,68,0.12)',
              color: isDarkMode ? '#f87171' : '#dc2626',
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-red-50 hover:!text-red-700 hover:!border-red-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            {!sidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">

        {/* Top Header */}
        <header
          style={{
            background: isDarkMode ? '#0f0f0f' : '#ffffff',
            borderBottom: isDarkMode ? '1px solid #272727' : '1px solid #e2e8f0',
          }}
          className="h-16 flex items-center justify-between px-4 lg:px-8 z-40 shrink-0 relative"
        >
          <div className="flex items-center gap-4 md:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="text-slate-500 hover:text-slate-700 p-1"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {logo ? (
              <img src={logo} alt={APP_NAME} className="h-6 w-auto" />
            ) : (
              <span className="font-bold text-sm truncate">{APP_NAME}</span>
            )}
          </div>

          <div className="hidden md:flex items-center text-sm font-medium"
            style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
          >
            <span style={{ color: isDarkMode ? '#64748b' : '#94a3b8' }} className="mr-2">{isSuperAdmin ? "Owner Portal" : APP_NAME}</span>
            <span style={{ color: isDarkMode ? '#374151' : '#cbd5e1' }} className="mx-2">/</span>
            <span style={{ color: isDarkMode ? '#e2e8f0' : '#1e293b' }} className="font-semibold">{currentPageTitle}</span>
          </div>

          <div className="flex items-center gap-3 ml-auto relative" ref={dropdownRef}>
            <NotificationBell />
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span style={{ color: isDarkMode ? '#f1f1f1' : '#1e293b' }} className="text-sm font-medium">{displayName}</span>
              <span style={{ color: isDarkMode ? '#aaaaaa' : '#64748b' }} className="text-xs">{roleLabel}</span>
            </div>
            <div
              className="h-9 w-9 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold text-white shadow-sm cursor-pointer hover:bg-brand-700 transition overflow-hidden border border-brand-700"
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            >
              {adminData?.profilePic ? (
                <img 
                  src={
                    adminData.profilePic.startsWith('http') 
                      ? adminData.profilePic 
                      : adminData.profilePic.startsWith('uploads/') 
                        ? `${API_URL}/${adminData.profilePic}`
                        : `${API_URL}/uploads/${adminData.profilePic}`
                  } 
                  alt="Profile" 
                  className="h-full w-full object-cover" 
                />
              ) : (
                initials || "U"
              )}
            </div>

            {profileDropdownOpen && (
              <div
                style={{
                  background: isDarkMode ? '#212121' : '#ffffff',
                  border: isDarkMode ? '1px solid #3f3f3f' : '1px solid #e2e8f0',
                }}
                className="absolute right-0 top-12 mt-2 w-56 rounded-xl shadow-xl py-1.5 z-50"
              >
                <div style={{ borderBottom: isDarkMode ? '1px solid #3f3f3f' : '1px solid #f1f5f9' }} className="px-4 py-2.5">
                  <p style={{ color: isDarkMode ? '#f1f1f1' : '#1e293b' }} className="text-sm font-semibold truncate">{displayName}</p>
                  <p style={{ color: isDarkMode ? '#aaaaaa' : '#64748b' }} className="text-xs truncate">{roleLabel}</p>
                </div>
                <Link
                  to={`/${roleSlug}/profile`}
                  style={{ color: isDarkMode ? '#d1d5db' : '#374151' }}
                  className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm hover:bg-blue-50 hover:!text-blue-600 transition-colors"
                  onClick={() => setProfileDropdownOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  Edit Profile
                </Link>
                <Link
                  to={`/${roleSlug}/shortcuts`}
                  style={{ color: isDarkMode ? '#d1d5db' : '#374151' }}
                  className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm hover:bg-blue-50 hover:!text-blue-600 transition-colors"
                  onClick={() => setProfileDropdownOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                  My Shortcuts
                </Link>
                <Link
                  to={`/${roleSlug}/settings`}
                  style={{ color: isDarkMode ? '#d1d5db' : '#374151' }}
                  className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm hover:bg-blue-50 hover:!text-blue-600 transition-colors"
                  onClick={() => setProfileDropdownOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                  Settings
                </Link>
                {/* Dark / Light toggle row */}
                <div style={{ borderTop: isDarkMode ? '1px solid #3f3f3f' : '1px solid #f1f5f9' }} className="my-1" />
                <button
                  onClick={() => { toggleTheme(); setProfileDropdownOpen(false); }}
                  style={{ color: isDarkMode ? '#d1d5db' : '#374151' }}
                  className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm hover:bg-blue-50 hover:!text-blue-600 transition-colors"
                >
                  {isDarkMode ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                  )}
                  {isDarkMode ? 'Light Mode' : 'Dark Mode'}
                </button>
                <div style={{ borderTop: isDarkMode ? '1px solid #3f3f3f' : '1px solid #f1f5f9' }} className="my-1" />
                <button
                  onClick={() => { setProfileDropdownOpen(false); handleLogout(); }}
                  className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Scrollable Page Content */}
        <main
          style={{ background: isDarkMode ? '#0a0a0a' : '#f1f5f9' }}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 relative"
        >
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>

      </div>

    </div>
  );
}
