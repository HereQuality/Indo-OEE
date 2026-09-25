# Indo OEE — mobile app (Flutter, iOS + Android)

Native app for the Indo OEE platform. It is **front end only**: it talks to the same
backend as the web client (`https://indo.hqepl.com`, REST `/api/v1`, `/uploads`, socket.io)
and shows the same menus and permissions — what a role sees is decided by the server
(Menu Master, Menu Group, Manage Role), exactly as on the web.

| | |
|---|---|
| Screens | Login → Home → Production Dashboard (Power-BI-style) → Data Entry → Profile / Settings / Shortcuts / Notifications / Support, plus every master & admin page the role has access to |
| App id | `com.hqepl.indo` (iOS bundle id and Android applicationId) |
| Package | `indo` |
| State | `provider` · HTTP `dio` · charts `fl_chart` · sockets `socket_io_client` |

## Run

```bash
cd mobile
flutter pub get
flutter run                                   # iOS simulator / Android emulator / device
```

**iOS (Xcode):** open **`ios/Runner.xcworkspace`** (not `Runner.xcodeproj`), pick a device,
Run. If Xcode says `Module '…' not found`, the CocoaPods step is missing:
`cd ios && pod install`. Set your Team under *Signing & Capabilities* if it is not already
`R44MH4Q9VG`.

**Point at another backend** (staging / a local server):

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5000     # Android emulator -> host machine
flutter run --dart-define=API_BASE_URL=http://127.0.0.1:5000    # iOS simulator
```

Debug builds allow cleartext `http://`; release builds need `https://`.

## Build

```bash
flutter build apk --release            # build/app/outputs/flutter-apk/app-release.apk
flutter build appbundle --release      # Play Store (.aab)
flutter build ios --release            # then Product -> Archive in Xcode
```

The template signs release builds with the **debug key**. Before publishing create your own
keystore and reference it from `android/app/build.gradle.kts` (`key.properties`). Signing
keys (`*.jks`, `*.keystore`, `*.p12`, `*.mobileprovision`, `key.properties`) are git-ignored —
keep them somewhere safe, never in the repo.

Regenerate the app icon / launch screen from `assets/branding/`:

```bash
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

## Layout

```
lib/
├── main.dart                 bootstrap (loads the saved login before the first frame)
├── app/                      MaterialApp, auth gate, route registry, drawer/scaffold, page guard
├── core/                     config, Dio client + Api helpers, theme, form widgets, utils
├── models/  providers/       user, menus/permissions, auth, theme, unread counters
└── features/                 one folder per area: auth, home, production, employee_management,
                              admin, teams, support, notifications, settings, profile …
test/                         widget + unit tests (FakeApi in test/support)
docs/PORTING_GUIDE.md         how screens were ported from the React client and the conventions
```

## Tests

```bash
flutter analyze
flutter test
```
