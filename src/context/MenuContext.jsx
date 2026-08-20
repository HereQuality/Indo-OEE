import { createContext, useEffect, useState, useContext } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentUser } from "../api/auth.api";
import { getMenusByGroups } from "../api/menus.api";
import { getEmployeeRolesByRoleId } from "../api/employeeRoles.api";
import { AuthContext } from "./AuthContext";

const MenuContext = createContext();

// Cache duration in milliseconds (30 minutes)
const CACHE_DURATION = 30 * 60 * 1000;

const MenuProvider = ({ children }) => {
    const location = useLocation();
    const [menuData, setMenuData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [employeeId, setEmployeeId] = useState(null);
    const [employeeRoleId, setEmployeeRoleId] = useState(null);
    const [isStatusFetched, setIsStatusFetched] = useState(false);
    const [employeeRoles, setEmployeeRoles] = useState(null);
    const [currentPagePermissions, setCurrentPagePermissions] = useState({
        menuId: null,
        view: false,
        create: false,
        edit: false,
        delete: false,
    });

    // Local cache to store menu data
    // Using useRef pattern with useState to persist between renders
    const [menuCache, setMenuCache] = useState({
        adminMenus: null,
        roleMenus: {},
        timestamp: null
    });

    // Get auth state from AuthContext
    const { role: authRole, isSessionVerified, adminData } = useContext(AuthContext);

    // Check if the current user is an admin
    const checkUserRole = async () => {
        setIsStatusFetched(false);
        try {
            // Use authRole and adminData from AuthContext
            if (!authRole || !adminData) {
                return false;
            }

            const userData = adminData;
            setIsStatusFetched(true);
            // Set admin status, employee ID and role ID
            const isAdminUser = userData.roleType === "SuperAdmin";
            setIsAdmin(isAdminUser);
            setEmployeeId(userData._id);
            setEmployeeRoleId(userData.roleId);
            return isAdminUser;
        } catch (error) {
            console.error("Error checking user role:", error);
            return false;
        }
    };

    // Fetch employee roles based on roleId instead of employee ID
    const fetchEmployeeRoles = async (roleId) => {
        try {
            if (!roleId) return null;

            const response = await getEmployeeRolesByRoleId(roleId);

            if (response.data.isOk) {
                setEmployeeRoles(response.data.data[0]);
                return response.data.data[0];
            }

            return null;
        } catch (error) {
            console.error("Error fetching employee roles:", error);
            return null;
        }
    };

    // Helper to check if cache is valid
    const isCacheValid = () => {
        if (!menuCache.timestamp) return false;

        const now = Date.now();
        return (now - menuCache.timestamp) < CACHE_DURATION;
    };

    // Invalidate the menu cache (call this when roles are updated)
    const invalidateMenuCache = () => {
        setMenuCache({
            adminMenus: null,
            roleMenus: {},
            timestamp: null
        });
    };

    const fetchMenus = async (forceRefresh = false) => {
        try {
            // Use authRole from AuthContext
            if (!authRole) {
                setError("No authentication found");
                setLoading(false);
                return;
            }

            setLoading(true);

            // isAdmin/employeeRoleId were already computed by checkUserRole()
            // in the effect that runs when isSessionVerified/authRole change
            // (see below). Re-running checkUserRole() here would reset
            // isStatusFetched to false and back to true, which is itself a
            // dependency of the effect that calls fetchMenus() — causing an
            // infinite render loop. Read the already-computed value instead.
            const adminStatus = isAdmin;


            // Check if we have valid cached data
            if (!forceRefresh && isCacheValid()) {
                if (adminStatus && menuCache.adminMenus) {
                    setMenuData(menuCache.adminMenus);
                    setLoading(false);
                    return;
                } else if (!adminStatus && employeeRoleId && menuCache.roleMenus[employeeRoleId]) {
                    setMenuData(menuCache.roleMenus[employeeRoleId]);
                    setLoading(false);
                    return;
                }
            }

            // Get all menus
            const response = await getMenusByGroups();

            if (response.data.isOk) {
                let menuGroups = response.data.data;

                const now = Date.now();

                // If admin, store all menus
                if (adminStatus) {
                    setMenuData(menuGroups);
                    setMenuCache(prev => ({
                        ...prev,
                        adminMenus: menuGroups,
                        timestamp: now
                    }));
                }
                // If not admin, filter menus based on employee roles
                else if (employeeRoleId) {
                    const rolesData = await fetchEmployeeRoles(employeeRoleId);
                    if (rolesData && rolesData.roles) {
                        const filteredMenus = filterMenusByPermission(menuGroups, rolesData.roles);
                        setMenuData(filteredMenus);
                        setMenuCache(prev => ({
                            ...prev,
                            roleMenus: { ...prev.roleMenus, [employeeRoleId]: filteredMenus },
                            timestamp: now
                        }));
                    } else {
                        setMenuData([]);
                    }
                }

                // Update permissions for current page based on URL
                updatePermissionsByCurrentUrl();
            } else {
                setError(response?.data?.message || "Failed to get menu data");
            }
        } catch (error) {
            console.error("Error fetching menus:", error);
            setError(error.message || "Failed to fetch menus");
        } finally {
            setLoading(false);
        }
    };

    // Helper function to filter menus based on user permissions
    const filterMenusByPermission = (menuGroups, roles) => {
        if (!Array.isArray(menuGroups) || !Array.isArray(roles)) {
            return [];
        }

        // Filter menu groups
        const filteredGroups = menuGroups.filter(group => {
            if (group.isLink) {
                return roles.some(role =>
                    role.menuGroupId === group.groupId && role.view
                );
            }

            // For groups with menus, filter their child menus
            const filteredMenus = filterMenuItems(group.menus || [], roles);

            // If group has any visible menus, keep it
            if (filteredMenus.length > 0) {
                group.menus = filteredMenus;
                return true;
            }

            return false;
        });

        return filteredGroups;
    };

    // Recursive helper function to filter menu items at any nesting level
    const filterMenuItems = (menuItems, roles) => {
        if (!Array.isArray(menuItems) || !Array.isArray(roles)) {
            return [];
        }

        return menuItems.filter(menu => {
            const hasViewPermission = roles.some(role =>
                role.menuId === menu.id && role.view
            );

            // If this item has children, recursively filter them
            if (menu.children && menu.children.length > 0) {
                menu.children = filterMenuItems(menu.children, roles);

                return hasViewPermission || menu.children.length > 0;
            }
            return hasViewPermission;
        });
    };

    // Update the current page permissions based on menu ID
    const updateCurrentPagePermissions = (menuId) => {
        if (isAdmin) {
            setCurrentPagePermissions({
                menuId,
                view: true,
                create: true,
                edit: true,
                delete: true,
            });
            return;
        }

        if (!employeeRoles || !employeeRoles.roles || !menuId) {
            setCurrentPagePermissions({
                menuId: null,
                view: false,
                create: false,
                edit: false,
                delete: false,
            });
            return;
        }

        // Find the permission for this menu ID
        const menuPermission = employeeRoles.roles.find(role => role.menuId === menuId || role.menuGroupId === menuId);

        if (menuPermission) {
            setCurrentPagePermissions({
                menuId,
                view:   menuPermission.view   || false,
                create: menuPermission.create || false,
                edit:   menuPermission.edit   || false,
                delete: menuPermission.delete || false,
            });
        } else {
            setCurrentPagePermissions({
                menuId,
                view: false,
                create: false,
                edit: false,
                delete: false,
            });
        }
    };

    // Find permissions for a specific menu ID
    const getPermissionsForMenu = (menuId) => {
        if (isAdmin) {
            return {
                menuId,
                view: true,
                create: true,
                edit: true,
                delete: true,
            };
        }

        if (!employeeRoles || !employeeRoles.roles || !menuId) {
            return {
                menuId,
                view: false,
                create: false,
                edit: false,
                delete: false,
            };
        }

        const menuPermission = employeeRoles.roles.find(role => role.menuId === menuId || role.menuGroupId === menuId);

        if (menuPermission) {
            return {
                menuId,
                view:   menuPermission.view   || false,
                create: menuPermission.create || false,
                edit:   menuPermission.edit   || false,
                delete: menuPermission.delete || false,
            };
        }

        return {
            menuId,
            view: false,
            create: false,
            edit: false,
            delete: false,
        };
    };

    // Menu URLs are stored in the DB with a fixed prefix (e.g.
    // "/company/dashboard"), but now render under whichever role slug the
    // logged-in user has (e.g. "/manager/dashboard"). Strip the leading
    // segment before comparing so matching is prefix-agnostic.
    const stripFirstSegment = (path) => path.replace(/^\/[^/]+/, '');

    // Find menu ID by URL path
    const findMenuIdByUrl = (url) => {
        if (!url || !Array.isArray(menuData)) {
            return null;
        }

        // Remove trailing slash and query parameters
        const cleanUrl = stripFirstSegment(url.split('?')[0].replace(/\/+$/, ''));

        // Find menu with matching URL in all menu groups
        let foundMenuId = null;

        // First check direct link menu groups
        const directLinkGroup = menuData.find(group =>
            group.isLink && group.url && (stripFirstSegment(group.url) === cleanUrl || cleanUrl.endsWith(stripFirstSegment(group.url)))
        );

        if (directLinkGroup) {
            return directLinkGroup.groupId;
        }

        // Function to recursively search through menus
        const searchMenus = (menus) => {
            if (!Array.isArray(menus) || foundMenuId) return;

            for (const menu of menus) {
                if (menu.url && (stripFirstSegment(menu.url) === cleanUrl || cleanUrl.endsWith(stripFirstSegment(menu.url)))) {
                    foundMenuId = menu.id;
                    return;
                }

                // Check children menus
                if (menu.children && menu.children.length > 0) {
                    searchMenus(menu.children);
                }
            }
        };

        // Search through all menu groups
        for (const group of menuData) {
            if (group.menus && group.menus.length > 0) {
                searchMenus(group.menus);
                if (foundMenuId) break;
            }
        }

        return foundMenuId;
    };

    // Update permissions based on current URL
    const updatePermissionsByCurrentUrl = () => {
        // Get current path from window location
        const currentPath = window.location.pathname;

        // Find menu ID for current path
        const menuId = findMenuIdByUrl(currentPath);

        if (menuId) {
            updateCurrentPagePermissions(menuId);
        } else if (isAdmin) {
            setCurrentPagePermissions({
                menuId: null,
                view: true,
                create: true,
                edit: true,
                delete: true,
            });
        } else {
            setCurrentPagePermissions({
                menuId: null,
                view: false,
                create: false,
                edit: false,
                delete: false,
            });
        }
    };

    // Check user role when session is verified
    useEffect(() => {
        if (isSessionVerified && authRole) {
            checkUserRole();
        }
    }, [isSessionVerified, authRole]);

    // Refetch menus when role ID changes or status is fetched
    useEffect(() => {
        if (isSessionVerified && authRole && isStatusFetched) {
            fetchMenus();
        }
    }, [employeeRoleId, isSessionVerified, authRole, isStatusFetched]);

    // Listen for URL changes to update permissions
    useEffect(() => {
        // Update permissions based on URL when menus are loaded or location changes
        if (!loading && menuData.length > 0) {
            updatePermissionsByCurrentUrl();
        }
    }, [loading, menuData, location.pathname]);

    return (
        <MenuContext.Provider value={{
            menuData,
            loading,
            error,
            fetchMenus,
            isAdmin,
            employeeRoles,
            invalidateMenuCache,
            currentPagePermissions,
            updateCurrentPagePermissions,
            getPermissionsForMenu,
            findMenuIdByUrl,
            updatePermissionsByCurrentUrl
        }}>
            {children}
        </MenuContext.Provider>
    );
};

export { MenuContext, MenuProvider };