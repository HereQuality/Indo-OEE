import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_data.dart' show shortCause, stoppageCauses, stoppageMachines;
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/data/dashboard_models.dart';
import 'package:indo/features/production/dashboard/shell/dashboard_controller.dart';
import 'package:indo/features/production/dashboard/shell/process_overview.dart' show processSubtitle;

import '../../calc/golden_support.dart';

/// The BEFORE POWDER COATING dashboard against the REAL web
/// utils/processDashboard.js (fixtures from tool/gen_bpc_golden.mjs): a worker
/// (operator) process, its four stoppage causes, B.D. (Breakdown) in its own
/// words, and each entry's own OEE in the figures.
final dir = Platform.environment['BPC_FIXTURE_DIR'] ?? 'test/production/processes/bpc/fixtures';

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);

const bpcProcess = ProcessInfo(id: 'p1', name: 'BEFORE POWDER COATING', dataEntryMenu: '/hqepl/production/before-powder-coating-data-entry');

void main() {
  final f = loadFixture('dashboard.json', dir: dir) as Map;

  test('worker process, stoppage keys and cause words per process match the web', () {
    for (final c in f['processes'] as List) {
      final p = m(c['process']);
      expect(eng.isWorkerProcess(p), c['worker'], reason: '$p');
      expect(eng.stoppageKeysFor(p), c['stoppageKeys'], reason: '$p');
      expect(eng.causeLabelsFor(p), c['causeLabels'], reason: '$p');
    }
    expect(eng.causeLabelsFor(null), isEmpty);
    // The landing page's process tile: entries come per operator, not per machine.
    expect(processSubtitle(bpcProcess), 'Per worker');
  });

  test('causeLabel reads B.D. (Breakdown) only with this sheet\'s words', () {
    final labels = eng.causeLabelsFor({'processName': 'BEFORE POWDER COATING'});
    for (final c in f['causeLabels'] as List) {
      expect(eng.causeLabel(c['key'] as String), c['plain'], reason: '${c['key']}');
      expect(eng.causeLabel(c['key'] as String, labels), c['bpc'], reason: '${c['key']}');
    }
  });

  test('the controller hands the charts the process\'s words, causes and cause labels', () {
    final c = DashboardController(processId: 'p1', process: bpcProcess);
    expect(c.ctx.words.byWorker, isTrue);
    expect(c.ctx.stoppageKeys, ['setupMin', 'bdMechMin', 'lunchMin', 'otherMin']);
    expect(c.ctx.causeLabels, {'bdMechMin': 'B.D. (Breakdown) (min)'});
    c.dispose();

    // A machine process and "All machines" keep the shared words.
    final cnc = DashboardController(processId: 'p2', process: const ProcessInfo(id: 'p2', name: 'CNC', dataEntryMenu: '/hqepl/production/cnc-data-entry'));
    expect(cnc.ctx.causeLabels, isEmpty);
    expect(cnc.ctx.words.byWorker, isFalse);
    cnc.dispose();
    final all = DashboardController();
    expect(all.ctx.causeLabels, isEmpty);
    expect(all.ctx.stoppageKeys, isNull);
    all.dispose();
  });

  test('Downtime by Cause and the treemap say B.D. (Breakdown) on this dashboard', () {
    final rows = <Map<String, dynamic>>[
      {'_id': 'a', 'machine': 'op1', 'date': '2026-05-13', 'itemName': 'BODY', 'machineOnTime': '08:00', 'machineOffTime': '12:00', 'totalCycleSec': 20.0, 'actualQty': 600.0, 'okQty': 600.0, 'setupMin': 10.0, 'bdMechMin': 20.0, 'lunchMin': 30.0},
    ];
    const ctx = DashboardCtx(machineName: {'op1': 'SUREKHA'}, machineOrder: {}, bucket: 'date', causeLabels: {'bdMechMin': 'B.D. (Breakdown) (min)'});
    const plain = DashboardCtx(machineName: {'op1': 'SUREKHA'}, machineOrder: {}, bucket: 'date');
    expect(shortCause('bdMechMin', ctx), 'B.D. (Breakdown)');
    expect(shortCause('bdMechMin', plain), 'B.D. Mech.');
    expect(shortCause('lunchMin', ctx), 'Lunch / Tea');
    expect([for (final d in stoppageCauses(rows, ctx)) d.label], ['Lunch / Tea', 'B.D. (Breakdown)', 'Setup Time']);
    expect([for (final d in stoppageCauses(rows)) d.label], ['Lunch / Tea', 'B.D. Mech.', 'Setup Time']);
    final machines = stoppageMachines(rows, ctx);
    expect([for (final c in machines.single.causes) c.$2], ['Lunch / Tea', 'B.D. (Breakdown)', 'Setup Time']);
  });

  test('summarize over the server\'s feed matches the web: each entry its own OEE, a locked day once', () {
    final cases = loadFixture('summary.json', dir: dir) as List;
    expect(cases.length, greaterThan(20));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final rows = [
        for (final r in c['rows'] as List)
          // The dashboard widens JSON ints to doubles on the way in (dashboard_models.dart).
          {for (final e in m(r).entries) e.key: e.value is int ? (e.value as int).toDouble() : e.value},
      ];
      expect(diff(eng.summarize(rows), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
    }
    // The paper's six rows: OEE considering losses is the mean of the six entries' own.
    final paper = eng.summarize([
      for (final r in (cases.first as Map)['rows'] as List)
        {for (final e in m(r).entries) e.key: e.value is int ? (e.value as int).toDouble() : e.value},
    ]);
    expect(paper['oeeLosses'] as double, closeTo((0.8844 + 0.9583 + 0.875 + 0.6667 + 0.8695 + 0.9327) / 6, 1e-3));
  });
}
