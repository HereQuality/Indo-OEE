import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config.dart';

/// One socket.io connection for the whole app (notifications bell, support
/// chat, maintenance banner all listen on this instead of opening their own).
///
/// The server only lets a socket join a person's room after verifying the same
/// JWT the REST API uses, so [connect] emits `join` with the token on every
/// (re)connect.
class SocketService {
  SocketService._();
  static final SocketService instance = SocketService._();

  io.Socket? _socket;
  String? _token;

  /// True while the socket is connected.
  final ValueNotifier<bool> connected = ValueNotifier(false);

  io.Socket? get socket => _socket;

  void connect(String token) {
    if (_socket != null && _token == token) return;
    disconnect();
    _token = token;
    final s = io.io(
      AppConfig.apiBaseUrl,
      io.OptionBuilder().setTransports(['websocket', 'polling']).disableAutoConnect().build(),
    );
    _socket = s;
    s.onConnect((_) {
      connected.value = true;
      s.emit('join', _token);
    });
    s.onDisconnect((_) => connected.value = false);
    s.onConnectError((e) => debugPrint('socket connect error: $e'));
    s.connect();
  }

  void disconnect() {
    final s = _socket;
    _socket = null;
    _token = null;
    if (s != null) {
      s.dispose();
    }
    connected.value = false;
  }

  /// Subscribe; returns a callback that unsubscribes. Safe to call before the
  /// socket exists (the listener is simply not attached).
  VoidCallback on(String event, void Function(dynamic data) handler) {
    final s = _socket;
    if (s == null) return () {};
    s.on(event, handler);
    return () => s.off(event, handler);
  }

  void emit(String event, [dynamic data]) => _socket?.emit(event, data);
}
