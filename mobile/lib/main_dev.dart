// TEMPORARY verification launcher - NOT part of the shipped app (delete after use).
// Signs in against a local backend and lets a control file drive the running app
// (navigate, tap by text, scroll, toggle dark mode) so screens can be screenshotted
// without any UI-automation tooling.
//
//   flutter run -d <sim> -t lib/main_dev.dart \
//     --dart-define=API_BASE_URL=http://127.0.0.1:5077 --dart-define=DEV_CTL=/path/ctl.txt
//
// Append a line to the control file to run a command:
//   nav /production/dashboard | dark 1 | account | pop | tap Text | tap ~partial#2 | scroll 500 | scroll top | wait 800
import 'dart:async';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:provider/provider.dart';

import 'app/account_sheet.dart';
import 'app/app.dart';
import 'app/navigation.dart';
import 'core/api/api_client.dart';
import 'core/api/endpoints.dart';
import 'core/storage/auth_storage.dart';
import 'core/utils/alerts.dart';
import 'providers/theme_provider.dart';

const _ctlPath = String.fromEnvironment('DEV_CTL');
const _user = String.fromEnvironment('DEV_USER', defaultValue: 'hqepl');
const _pass = String.fromEnvironment('DEV_PASS', defaultValue: 'Admin@123');

int _done = 0;
bool _busy = false;
int _pointer = 9000;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AuthStorage.instance.init();
  try {
    final res = await ApiClient.instance.dio.post(Endpoints.login, data: {'username': _user, 'password': _pass});
    final data = res.data as Map;
    final u = (data['data'] as Map?)?['user'] as Map?;
    await AuthStorage.instance.save(token: data['token'].toString(), role: (u?['roleType'] ?? '').toString());
    debugPrint('DEV login ok as $_user');
  } catch (e) {
    debugPrint('DEV LOGIN FAILED: $e');
  }
  runApp(const IndoApp());
  Timer.periodic(const Duration(milliseconds: 400), (_) => _poll());
}

Future<void> _poll() async {
  if (_busy || _ctlPath.isEmpty) return;
  final f = File(_ctlPath);
  if (!await f.exists()) return;
  final lines = (await f.readAsLines()).where((l) => l.trim().isNotEmpty).toList();
  if (lines.length <= _done) return;
  _busy = true;
  try {
    while (_done < lines.length) {
      final l = lines[_done++].trim();
      debugPrint('DEV> $l');
      try {
        await _run(l);
      } catch (e, st) {
        debugPrint('DEV command failed: $e\n$st');
      }
    }
  } finally {
    _busy = false;
  }
}

Future<void> _run(String line) async {
  final sp = line.indexOf(' ');
  final cmd = sp < 0 ? line : line.substring(0, sp);
  final arg = sp < 0 ? '' : line.substring(sp + 1).trim();
  final ctx = rootNavigatorKey.currentContext;
  if (ctx == null) return;
  switch (cmd) {
    case 'nav':
      AppNav.go(ctx, arg);
    case 'dark':
      await ctx.read<ThemeProvider>().setDark(arg == '1');
    case 'account':
      unawaited(showAccountSheet(ctx));
    case 'pop':
      await rootNavigatorKey.currentState?.maybePop();
    case 'tap':
      await _tap(arg);
    case 'scroll':
      _scroll(arg);
    case 'swipe':
      await _swipe(arg);
    case 'wait':
      await Future<void>.delayed(Duration(milliseconds: int.tryParse(arg) ?? 500));
  }
}

int get _viewId => WidgetsBinding.instance.platformDispatcher.views.first.viewId;

/// True when [ro] is the topmost thing (or part of it) at its own centre - i.e. visible, on
/// screen and not covered by a sheet / offstage.
Offset? _visibleCentre(RenderObject? ro) {
  if (ro is! RenderBox || !ro.attached || !ro.hasSize || ro.size.isEmpty) return null;
  final c = ro.localToGlobal(ro.size.center(Offset.zero));
  final result = HitTestResult();
  RendererBinding.instance.hitTestInView(result, c, _viewId);
  return result.path.any((e) => e.target == ro) ? c : null;
}

Future<void> _tap(String query) async {
  var q = query;
  var nth = 0;
  final m = RegExp(r'^(.*)#(\d+)$').firstMatch(q);
  if (m != null) {
    q = m.group(1)!.trim();
    nth = int.parse(m.group(2)!);
  }
  final contains = q.startsWith('~');
  if (contains) q = q.substring(1);
  final want = q.toLowerCase();
  final hits = <Offset>[];
  void visit(Element e) {
    final w = e.widget;
    String? label;
    if (w is Text) {
      label = w.data ?? w.textSpan?.toPlainText();
    } else if (w is Tooltip) {
      label = w.message;
    }
    if (label != null) {
      final l = label.trim().toLowerCase();
      if (contains ? l.contains(want) : l == want) {
        final c = _visibleCentre(e.renderObject);
        if (c != null) hits.add(c);
      }
    }
    e.visitChildren(visit);
  }

  WidgetsBinding.instance.rootElement?.visitChildren(visit);
  if (hits.length <= nth) {
    debugPrint('DEV tap: no visible match for "$query" (found ${hits.length})');
    return;
  }
  final pos = hits[nth];
  final p = _pointer++;
  GestureBinding.instance.handlePointerEvent(PointerDownEvent(pointer: p, position: pos, kind: PointerDeviceKind.touch));
  await Future<void>.delayed(const Duration(milliseconds: 70));
  GestureBinding.instance.handlePointerEvent(PointerUpEvent(pointer: p, position: pos, kind: PointerDeviceKind.touch));
}

void _scroll(String arg) {
  ScrollableState? best;
  var bestArea = 0.0;
  void visit(Element e) {
    if (e is StatefulElement && e.state is ScrollableState) {
      final s = e.state as ScrollableState;
      final ro = s.context.findRenderObject();
      if (axisDirectionToAxis(s.widget.axisDirection) == Axis.vertical &&
          s.position.hasContentDimensions &&
          s.position.maxScrollExtent > 20 &&
          _visibleCentre(ro) != null) {
        final area = (ro! as RenderBox).size.width * (ro as RenderBox).size.height;
        if (area > bestArea) {
          bestArea = area;
          best = s;
        }
      }
    }
    e.visitChildren(visit);
  }

  WidgetsBinding.instance.rootElement?.visitChildren(visit);
  final s = best;
  if (s == null) {
    debugPrint('DEV scroll: no vertical scrollable found');
    return;
  }
  final pos = s.position;
  final target = arg == 'top'
      ? pos.minScrollExtent
      : arg == 'bottom'
          ? pos.maxScrollExtent
          : pos.pixels + (double.tryParse(arg) ?? 400);
  pos.jumpTo(target.clamp(pos.minScrollExtent, pos.maxScrollExtent));
}

/// `swipe l` / `swipe r` / `swipe l 200,600` - a horizontal finger drag (optionally starting at x,y).
Future<void> _swipe(String arg) async {
  final parts = arg.split(' ');
  final left = parts.first == 'l';
  final view = WidgetsBinding.instance.platformDispatcher.views.first;
  final size = view.physicalSize / view.devicePixelRatio;
  var start = Offset(size.width * (left ? 0.8 : 0.2), size.height * 0.5);
  if (parts.length > 1) {
    final xy = parts[1].split(',');
    start = Offset(double.parse(xy[0]), double.parse(xy[1]));
  }
  final p = _pointer++;
  GestureBinding.instance.handlePointerEvent(PointerDownEvent(pointer: p, position: start, kind: PointerDeviceKind.touch));
  for (var i = 1; i <= 12; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 16));
    final dx = (left ? -1 : 1) * i * 22.0;
    GestureBinding.instance.handlePointerEvent(
      PointerMoveEvent(pointer: p, position: start + Offset(dx, 0), delta: Offset((left ? -1 : 1) * 22.0, 0), kind: PointerDeviceKind.touch),
    );
  }
  GestureBinding.instance.handlePointerEvent(
    PointerUpEvent(pointer: p, position: start + Offset((left ? -1 : 1) * 264.0, 0), kind: PointerDeviceKind.touch),
  );
}
