import 'package:flutter/material.dart';

/// Centered spinner.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(width: 32, height: 32, child: CircularProgressIndicator(strokeWidth: 3)),
            if (label != null) ...[
              const SizedBox(height: 14),
              Text(label!, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ],
          ],
        ),
      );
}

/// Error with a Retry button.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_rounded, size: 44, color: s.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: TextStyle(color: s.onSurfaceVariant)),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
            ],
          ],
        ),
      ),
    );
  }
}

/// "Nothing here" placeholder.
class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.message, this.icon = Icons.inbox_outlined, this.action});
  final String message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: s.onSurfaceVariant.withValues(alpha: 0.6)),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: TextStyle(color: s.onSurfaceVariant)),
            if (action != null) ...[const SizedBox(height: 16), action!],
          ],
        ),
      ),
    );
  }
}

/// Runs [load] and renders loading / error / data — for screens that don't
/// need their own state object. Call `AsyncBody.reload(context)` (via the
/// returned key's state) or use [onRetry].
class AsyncBody<T> extends StatefulWidget {
  const AsyncBody({super.key, required this.load, required this.builder, this.emptyMessage, this.isEmpty});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final String? emptyMessage;
  final bool Function(T data)? isEmpty;

  @override
  State<AsyncBody<T>> createState() => _AsyncBodyState<T>();
}

class _AsyncBodyState<T> extends State<AsyncBody<T>> {
  T? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await widget.load();
      if (!mounted) return;
      setState(() {
        _data = d;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const LoadingView();
    if (_error != null && _data == null) return ErrorView(message: _error!, onRetry: _run);
    final d = _data as T;
    if (widget.isEmpty != null && widget.isEmpty!(d)) {
      return EmptyView(message: widget.emptyMessage ?? 'Nothing here yet.');
    }
    return widget.builder(context, d, _run);
  }
}
