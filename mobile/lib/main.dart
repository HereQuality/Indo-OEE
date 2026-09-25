import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app/app.dart';
import 'core/storage/auth_storage.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load the saved token before the first frame: the API layer reads it
  // synchronously.
  await AuthStorage.instance.init();
  await SystemChrome.setPreferredOrientations(DeviceOrientation.values);
  runApp(const IndoApp());
}
