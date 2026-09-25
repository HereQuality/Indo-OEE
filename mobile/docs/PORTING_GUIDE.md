# Indo OEE mobile — porting guide

The Flutter app in `mobile/` (iOS + Android, package `indo`, app id `com.hqepl.indo`) is a
native re-implementation of the React web client in `client/`. Same backend, same screens,
same role/menu permissions — rebuilt as Flutter widgets. This guide is the contract every
screen follows so the pieces fit together.

## Sources of truth (READ-ONLY)

| What | Where |
|---|---|
| Web pages / components / hooks / utils / api | `../client/src/**` (`pages/`, `Components/`, `hooks/`, `api/`, `utils/`, `context/`) |
| Backend routes, controllers, models (the real request/response shapes) | `../server/routes`, `../server/controllers`, `../server/models` |
| Product notes | `../indo.md` |

**Never edit `client/` or `server/`.** Other people are changing them right now. Read the
current working-tree files (they are newer than any git commit).

## What already exists (do NOT re-implement; do NOT edit)

Owned by the foundation — if you find a bug or need something added, say so in your final
report (and work around it locally inside your own feature folder).

```
lib/core/config.dart                    AppConfig.apiBaseUrl, toBackendUrl(String?)  (uploads -> absolute https URL)
lib/core/api/api_client.dart            Api.get/post/put/patch/delete/postForm/putForm -> Map<String,dynamic>
                                        ApiException(message,statusCode)   asList(res)  asMap(res)
lib/core/api/endpoints.dart             Endpoints.* (every URL the web app uses)
lib/core/api/socket_service.dart        SocketService.instance.on('event', cb) -> unsubscribe fn
lib/core/utils/alerts.dart              Alerts.success/error/warning/info(msg)   Alerts.confirm(context, msg,{title,confirmText,danger})
lib/core/utils/formatters.dart          Fmt.date/dateTime/time/ymd/hm12/number/percent/minutes/initials/parse
lib/core/utils/validators.dart          Validators.required/email/phone/number/minLength
lib/core/theme/app_colors.dart          AppColors.* (brand/navy/slate/ok/warn/critical) + AppColors.readable(context, tone)
lib/core/widgets/form_widgets.dart      AppTextField, AppDropdownField<T>(options: [PickOption]), AppDateField, AppTimeField,
                                        PrimaryButton(loading:), SearchField, FieldLabel, showPicker()
lib/core/widgets/common_widgets.dart    SectionCard, StatusChip, UserAvatar, InfoRow
lib/core/widgets/states.dart            LoadingView, ErrorView(onRetry), EmptyView, AsyncBody<T>
lib/core/widgets/dynamic_icon.dart      DynamicIcon(name) — lucide names stored in Menu Master
lib/core/widgets/page_permissions.dart  PagePermissions.of(context) -> PagePerms{view,create,edit,delete}
lib/models/app_user.dart, menu_models.dart
lib/providers/*                         AuthProvider (user, isSuperAdmin, refreshUser, updatePreferences, logout),
                                        MenuProvider (groups, permissionsForPath, reload), ThemeProvider (isDark, setDark),
                                        UnreadProvider (notifications, tickets, refresh()), CompanyProvider (name, logo)
lib/app/app_scaffold.dart               AppScaffold(title, body, actions, floatingActionButton, bottom) — top-level page shell
lib/app/navigation.dart                 AppNav.go(context, '/production/machines' | full menu url)
lib/app/routes.dart                     the route registry (already lists every screen class)
test/support/fake_api.dart              FakeApi (fake backend for widget tests) + pumpScreen(tester, screen, ...)
```

## Your job

Each screen already exists as a STUB file (`lib/features/<group>/<name>_screen.dart`) with a
fixed class name and `const Foo({super.key})` constructor — `app/routes.dart` builds it.
Replace the stub with the real, complete port of the web page. **Keep the class name, file
name and constructor.** Put everything else you need in your own files under your own
feature folder (e.g. `lib/features/production/machines/…`). Never touch a file another group owns.

Fully port the page: every list, filter, search, form field, validation rule, calculation,
permission check, confirmation, empty state, status badge, and side effect the web page has.
Read the web page AND the server controller/model it talks to so field names, required
fields, enums, defaults and edge cases match. Where the web page has a feature that cannot
work on a phone (hover tooltips, drag-and-drop, wide spreadsheets, file downloads), use the
closest mobile idiom and list it in your report — do not silently drop functionality.

## Mobile conventions

* **Top-level page** = `AppScaffold(title: …, body: …)` (drawer + bell come with it). Detail
  screens, forms and editors you push with `Navigator.push` use a normal `Scaffold` + `AppBar`.
* **Permissions:** read `PagePermissions.of(context)` in the top-level screen and hide/disable
  Add (`create`), Edit (`edit`) and Delete (`delete`) exactly like the web page does. Pass
  `PagePerms` to pushed screens as a constructor argument. SuperAdmin gets everything.
* **Data:** call `Api.*` (throws `ApiException` with a user-readable `message`). Show
  `LoadingView` → data / `EmptyView` / `ErrorView(onRetry:)`. Pull-to-refresh (`RefreshIndicator`)
  on every list. Debounce search (300 ms) and filter server-side when the web page does.
  Mutations: disable the button while saving (`PrimaryButton(loading:)`), toast success
  (`Alerts.success`) or the server's error (`Alerts.error(e.message)`), then refresh.
  Deletes/dangerous actions: `Alerts.confirm(...)` first.
* **State:** a small `ChangeNotifier` per feature or plain `StatefulWidget` — keep it simple.
  Guard every `await` with `if (!mounted) return;`. Dispose controllers/subscriptions.
* **Parse defensively:** server fields can be null/missing/number-or-string. Put models in
  your feature folder with `fromJson`; never let a bad row crash the list.
* **Tables → mobile:** turn wide tables into cards / `ListTile`s with the key fields, a
  status chip, and a trailing menu (`PopupMenuButton`) for row actions. Where a spreadsheet
  layout is the point (production sheet), use a horizontally scrollable `DataTable` with a
  sticky first column, or an expandable card per row — pick what is usable on a 390 px phone.
* **Modals → bottom sheets / dialogs / pushed screens.** react-select → `AppDropdownField`
  (searchable sheet). Date/time pickers → `AppDateField` / `AppTimeField`.
* **Look:** Material 3 with the app theme. Never hard-code light colours or `Colors.white`
  backgrounds — use `Theme.of(context).colorScheme.*`, `Card`, and `AppColors.readable(...)`
  for coloured text on tinted pills. **Every screen must be correct in light AND dark mode.**
* **Phones first, tablets fine:** design for 360–430 px wide; use `LayoutBuilder` /
  `ConstrainedBox(maxWidth: 720)` so an iPad/tablet does not stretch forms edge to edge.
  No fixed heights that overflow at large text sizes (test `textScale: 1.6`). Tap targets
  ≥ 44 px. Respect safe areas; keyboard must never cover the focused field (scrollable forms,
  `resizeToAvoidBottomInset`). Landscape must not overflow.
* **No new packages.** `pubspec.yaml` is frozen. Available: dio, provider, intl, fl_chart,
  image_picker, file_picker, cached_network_image, url_launcher, shared_preferences,
  package_info_plus, path_provider, collection, timeago, lucide_icons_flutter, socket_io_client.
  If you truly need another, use a fallback and say so in your report.
* Comments: only where the *why* is non-obvious (e.g. a server quirk). Match the surrounding style.

## Verify your work (required)

Other workers are editing other folders at the same time, so:

1. `dart analyze <your files/folders only>` — zero errors and zero warnings (infos in files
   you wrote should be fixed too). Do NOT run `dart analyze lib` for the whole project.
2. Write widget tests in `test/<your_feature>/…_test.dart` using `FakeApi` + `pumpScreen`
   (`test/support/fake_api.dart`; see `test/foundation_test.dart` for usage). Cover: loads and
   renders rows, empty state, error + retry, search/filter, create/edit/delete round-trip
   (assert the request the fake received), validation errors, permission gating (pass
   `perms: PagePerms(view: true)` and assert Add/Edit/Delete are absent), dark mode
   (`dark: true`), large text (`textScale: 1.6`) and a small phone (`size: Size(360, 640)`)
   without overflow exceptions (`expect(tester.takeException(), isNull)`).
3. `flutter test test/<your_feature>` — all green.
4. **Do NOT run `flutter run`, `flutter build`, `pod install`, or touch `ios/`, `android/`,
   `pubspec.yaml`** (a shared build directory; the lead runs the simulator/device checks).
5. Long commands: run them with `run_in_background` and poll; a command that prints nothing
   for 3 minutes kills you.

A local test backend may be available: if `<scratchpad>/indo/server-ready.json` exists it
holds `{baseUrl, personas:[{username,password,role}]}` — you can `curl` it to see real
response shapes (never against the production URL `https://indo.hqepl.com`).

## Final report (your last message)

Plain text, no fluff:
1. Screens/files created (paths).
2. Parity: web features ported, and every one adapted or omitted for mobile with the reason.
3. Server quirks / API shapes worth knowing.
4. Core issues or requests for the foundation (file + what you needed).
5. `dart analyze` and `flutter test` results with exact counts.
6. How to see each screen in the running app (menu path).
