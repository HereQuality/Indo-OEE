/// One entry of the sidebar tree returned by GET /menus/by-groups.
class MenuItem {
  MenuItem({
    required this.id,
    required this.name,
    this.url,
    this.icon,
    this.children = const [],
  });

  final String id;
  final String name;
  final String? url;
  final String? icon;
  final List<MenuItem> children;

  factory MenuItem.fromJson(Map<String, dynamic> j) => MenuItem(
        id: (j['id'] ?? j['_id'] ?? '').toString(),
        name: (j['name'] ?? j['menuName'] ?? '').toString(),
        url: j['url']?.toString(),
        icon: j['icon']?.toString(),
        children: (j['children'] is List)
            ? (j['children'] as List)
                .whereType<Map>()
                .map((e) => MenuItem.fromJson(Map<String, dynamic>.from(e)))
                .toList()
            : const [],
      );
}

/// A top-level sidebar group. Either a direct link (`isLink`, e.g. "Home",
/// "Support") or a folder holding [menus].
class MenuGroup {
  MenuGroup({
    required this.groupId,
    required this.groupName,
    this.icon,
    this.isLink = false,
    this.url,
    this.menus = const [],
  });

  final String groupId;
  final String groupName;
  final String? icon;
  final bool isLink;
  final String? url;
  final List<MenuItem> menus;

  factory MenuGroup.fromJson(Map<String, dynamic> j) => MenuGroup(
        groupId: (j['groupId'] ?? j['_id'] ?? '').toString(),
        groupName: (j['groupName'] ?? '').toString(),
        icon: j['icon']?.toString(),
        isLink: j['isLink'] == true,
        url: j['url']?.toString(),
        menus: (j['menus'] is List)
            ? (j['menus'] as List)
                .whereType<Map>()
                .map((e) => MenuItem.fromJson(Map<String, dynamic>.from(e)))
                .toList()
            : const [],
      );
}

/// What the signed-in role may do on one page (Manage Role permissions).
class PagePerms {
  const PagePerms({this.view = false, this.create = false, this.edit = false, this.delete = false});

  final bool view;
  final bool create;
  final bool edit;
  final bool delete;

  static const all = PagePerms(view: true, create: true, edit: true, delete: true);
  static const none = PagePerms();

  factory PagePerms.fromRole(Map<String, dynamic> r) => PagePerms(
        view: r['view'] == true,
        create: r['create'] == true,
        edit: r['edit'] == true,
        delete: r['delete'] == true,
      );
}
