/// All API endpoints in one place (mirrors client/src/api/endpoints.jsx).
class Endpoints {
  Endpoints._();

  static const v1 = '/api/v1';

  // Auth
  static const login = '$v1/auth/login';
  static const me = '$v1/auth/me';
  static const updateProfile = '$v1/auth/me';
  static const updatePreferences = '$v1/auth/me/preferences';
  static const changePassword = '$v1/auth/me/password';
  static const logout = '$v1/auth/logout';
  static const otpSend = '$v1/auth/send-otp';
  static const otpVerify = '$v1/auth/verify-otp';
  static const passwordReset = '$v1/auth/reset-password';
  static const loginStatusByEmail = '$v1/auth/login-status';
  static String loginStatus(String userId) => '$v1/auth/login-status/$userId';
  static const verifySession = '$v1/auth/verify-session';
  static const checkUsername = '$v1/auth/check-username';

  // Companies
  static const companyDetails = '$v1/companies/getCompanyDetails';
  static const companies = '$v1/companies';
  static String companyById(String id) => '$v1/companies/$id';
  static const companySearch = '$v1/companies/search';

  // Maintenance / announcement
  static const maintenanceStatus = '$v1/maintenance/status';
  static const maintenance = '$v1/maintenance';
  static const announcementStatus = '$v1/announcement/status';
  static const announcement = '$v1/announcement';

  // Departments
  static const departments = '$v1/departments';
  static String departmentById(String id) => '$v1/departments/$id';
  static const departmentSearch = '$v1/departments/search';

  // Company holidays + weekly off
  static const companyHolidays = '$v1/company-holidays';
  static String companyHolidayById(String id) => '$v1/company-holidays/$id';
  static const weeklyOff = '$v1/company-holidays/weekly-off';
  static const weeklyOffUpdate = '$v1/company-holidays/weekly-off/update';

  // Machines
  static const machines = '$v1/machines';
  static String machineById(String id) => '$v1/machines/$id';
  static const machineSearch = '$v1/machines/search';

  // Processes + dashboard data
  static const processes = '$v1/processes';
  static String processById(String id) => '$v1/processes/$id';
  static const processSearch = '$v1/processes/search';
  static const processEntries = '$v1/processes/entries';

  // Items
  static const items = '$v1/items';
  static String itemById(String id) => '$v1/items/$id';
  static const itemSearch = '$v1/items/search';

  // Machine operators (production/operators)
  static const machineOperators = '$v1/machine-operators';
  static String machineOperatorById(String id) => '$v1/machine-operators/$id';
  static const machineOperatorSearch = '$v1/machine-operators/search';

  // Production data-entry sheet
  static const productionSheet = '$v1/production-sheet';
  static const productionSheetRow = '$v1/production-sheet/row';
  static const productionSheetExtent = '$v1/production-sheet/extent';
  static const productionSheetFilterOptions = '$v1/production-sheet/filter-options';
  static const productionSheetOccupied = '$v1/production-sheet/occupied';
  static const productionSheetOperators = '$v1/production-sheet/operators';
  static const productionSheetRejectReasons = '$v1/production-sheet/reject-reasons';

  // Operators (employees)
  static const operators = '$v1/operators';
  static String operatorById(String id) => '$v1/operators/$id';
  static const operatorSearch = '$v1/operators/search';
  static const teamMembers = '$v1/operators/team-members/list';
  static String operatorResetPassword(String id) => '$v1/operators/$id/reset-password';
  static String operatorImpersonate(String id) => '$v1/operators/$id/impersonate';

  // Roles
  static const roles = '$v1/roles';
  static String roleById(String id) => '$v1/roles/$id';
  static const roleSearch = '$v1/roles/search';

  // Operator roles (permissions per role)
  static const operatorRoles = '$v1/operator-roles';
  static String operatorRolesById(String roleId) => '$v1/operator-roles/$roleId';

  // Menus / menu groups
  static const menus = '$v1/menus';
  static String menuById(String id) => '$v1/menus/$id';
  static const menuSearch = '$v1/menus/search';
  static const menusByGroups = '$v1/menus/by-groups';
  static const menuGroups = '$v1/menu-groups';
  static String menuGroupById(String id) => '$v1/menu-groups/$id';
  static const menuGroupSearch = '$v1/menu-groups/search';
}
