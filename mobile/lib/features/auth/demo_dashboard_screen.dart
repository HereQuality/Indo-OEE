import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/widgets/common_widgets.dart';

/// "Try demo" from the login screen: a read-only preview of what the OEE
/// dashboard shows, with made-up numbers. It is not signed in, talks to no
/// server and keeps nothing, so anyone can look around before getting an
/// account from their company. The screen says so at the top.
class DemoDashboardScreen extends StatelessWidget {
  const DemoDashboardScreen({super.key});

  static const _machines = [
    _DemoMachine('VMC-01', 0.93, 0.95, 0.99),
    _DemoMachine('VMC-02', 0.89, 0.91, 0.98),
    _DemoMachine('Press-03', 0.86, 0.88, 0.97),
    _DemoMachine('Spring-01', 0.82, 0.90, 0.99),
    _DemoMachine('Rivet-02', 0.74, 0.85, 0.96),
    _DemoMachine('Powder Coating-01', 0.61, 0.82, 0.94),
  ];

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    double avg(double Function(_DemoMachine) f) => _machines.map(f).reduce((a, b) => a + b) / _machines.length;
    final availability = avg((m) => m.availability);
    final performance = avg((m) => m.performance);
    final quality = avg((m) => m.quality);
    // OEE = Availability x Performance x Quality (same definition as the sheets).
    final oee = availability * performance * quality;

    return Scaffold(
      appBar: AppBar(title: const Text('Demo dashboard')),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: s.primary.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: s.primary.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.info_outline, size: 20, color: s.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'This is a demo with sample data. It is not connected to any account or plant. '
                          'Your company gives you a username and password to see your own live OEE.',
                          style: TextStyle(fontSize: 13, height: 1.35, color: s.onSurface),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    _Kpi(label: 'OEE', value: oee, emphasis: true),
                    _Kpi(label: 'Availability', value: availability),
                    _Kpi(label: 'Performance', value: performance),
                    _Kpi(label: 'Quality', value: quality),
                  ],
                ),
                const SizedBox(height: 16),
                SectionCard(
                  title: 'Machines (sample shift)',
                  child: Column(
                    children: [for (final m in _machines) _MachineRow(m)],
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'OEE = Availability × Performance × Quality',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const Icon(Icons.arrow_back_rounded, size: 18),
                  label: const Text('Back to sign in'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DemoMachine {
  const _DemoMachine(this.name, this.availability, this.performance, this.quality);
  final String name;
  final double availability;
  final double performance;
  final double quality;

  double get oee => availability * performance * quality;
}

/// Green at world-class OEE (85%+), amber from 60%, red below.
Color _tone(double oee) => oee >= 0.85
    ? AppColors.ok
    : oee >= 0.60
        ? AppColors.warn
        : AppColors.critical;

String _pct(double v) => '${(v * 100).toStringAsFixed(1)}%';

class _Kpi extends StatelessWidget {
  const _Kpi({required this.label, required this.value, this.emphasis = false});
  final String label;
  final double value;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tone = emphasis ? _tone(value) : s.primary;
    return SizedBox(
      width: 200,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: s.onSurfaceVariant)),
              const SizedBox(height: 6),
              Text(
                _pct(value),
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppColors.readable(context, tone)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MachineRow extends StatelessWidget {
  const _MachineRow(this.machine);
  final _DemoMachine machine;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tone = _tone(machine.oee);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(machine.name, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: s.onSurface)),
              ),
              StatusChip(_pct(machine.oee), color: tone),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: machine.oee, minHeight: 8, color: tone, backgroundColor: s.surfaceContainerHighest),
          ),
          const SizedBox(height: 4),
          Text(
            'A ${_pct(machine.availability)}  ·  P ${_pct(machine.performance)}  ·  Q ${_pct(machine.quality)}',
            style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
