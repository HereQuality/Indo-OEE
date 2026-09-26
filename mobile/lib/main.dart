import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app/app.dart';
import 'core/storage/auth_storage.dart';
import 'core/widgets/app_error_widget.dart';

Future<void> main() async {
  // One zone for everything, so an error thrown in a timer / stream / future that
  // nobody awaits is logged instead of taking the app down with it.
  await runZonedGuarded<Future<void>>(() async {
    WidgetsFlutterBinding.ensureInitialized();

    FlutterError.onError = (details) {
      FlutterError.presentError(details); // logs (and shows the red box in debug)
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      debugPrint('Uncaught: $error\n$stack');
      return true; // handled: keep running
    };
    // A widget that fails to build shows a small message where it was, not a full-screen error.
    ErrorWidget.builder = (details) => AppErrorWidget(details);

    // Load the saved token before the first frame: the API layer reads it
    // synchronously.
    await AuthStorage.instance.init();
    await SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    runApp(const IndoApp());
  }, (error, stack) => debugPrint('Uncaught (zone): $error\n$stack'));
}
