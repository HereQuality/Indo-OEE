import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/theme/app_colors.dart';
import 'package:indo/features/audit_trail/audit_models.dart';

void main() {
  group('AuditFilters.toQuery', () {
    test('builds the exact query: comma lists, skip/limit, empty values left out', () {
      const f = AuditFilters(
        from: '2026-11-01',
        to: '2026-11-25',
        modules: ['entry', 'notRunning'],
        actions: ['marked', 'unmarked'],
        actor: 'u7',
        q: ' spindle ',
      );
      expect(f.toQuery(skip: 50), {
        'from': '2026-11-01',
        'to': '2026-11-25',
        'module': 'entry,notRunning',
        'action': 'marked,unmarked',
        'actor': 'u7',
        'q': 'spindle',
        'skip': 50,
        'limit': 50,
      });
    });

    test('a record history carries only its keys (no dates), paging optional', () {
      expect(const AuditFilters.forEntity('r1').toQuery(), {'entity': 'r1', 'skip': 0, 'limit': 50});
      expect(
        const AuditFilters.forMark(sheet: 'cnc', date: '2026-11-20', machine: 'm1').toQuery(paging: false),
        {'sheet': 'cnc', 'date': '2026-11-20', 'machine': 'm1'},
      );
      expect(const AuditFilters().toQuery(paging: false), isEmpty);
    });

    test('lastDays(30) is today and the 29 days before; thisMonth starts on the 1st', () {
      final now = DateTime(2026, 11, 25, 14, 30);
      final f = AuditFilters.lastDays(30, now: now);
      expect(f.from, '2026-10-27');
      expect(f.to, '2026-11-25');
      expect(AuditFilters.lastDays(1, now: now).from, '2026-11-25');
      expect(AuditFilters.thisMonth(now: now).from, '2026-11-01');
    });

    test('copyWith and equality', () {
      final a = AuditFilters.lastDays(30, now: DateTime(2026, 11, 25));
      final b = a.copyWith(modules: ['entry']);
      expect(a == b, isFalse);
      expect(b.copyWith(modules: const []), a);
      expect(b.hasNarrowing, isTrue);
      expect(a.hasNarrowing, isFalse);
    });
  });

  group('helpers', () {
    test('export file name is audit-trail-<from>_<to>.csv', () {
      expect(auditExportFileName(const AuditFilters(from: '2026-11-01', to: '2026-11-25')), 'audit-trail-2026-11-01_2026-11-25.csv');
      expect(auditExportFileName(const AuditFilters()), 'audit-trail-all_all.csv');
    });

    test('times are shown in IST as dd/mm/yyyy HH:mm', () {
      expect(formatIst(DateTime.utc(2026, 11, 25, 20, 45)), '26/11/2026 02:15');
      expect(formatIst(DateTime.utc(2026, 1, 5, 3, 4)), '05/01/2026 08:34');
      expect(formatIst(null), '—');
    });

    test('action labels and colours follow the contract', () {
      expect(auditActionLabel('marked'), 'Marked Not running');
      expect(auditActionLabel('unmarked'), 'Not running undone');
      expect(auditActionLabel('loginFailed'), 'Sign-in failed');
      expect(auditActionLabel('impersonate'), 'Signed in as another user');
      expect(auditActionLabel('flagged'), 'Over 100%');
      expect(auditActionColor('create'), AppColors.ok);
      expect(auditActionColor('login'), AppColors.ok);
      expect(auditActionColor('update'), AppColors.brand600);
      expect(auditActionColor('setting'), AppColors.brand600);
      expect(auditActionColor('delete'), AppColors.critical);
      expect(auditActionColor('loginFailed'), AppColors.critical);
      expect(auditActionColor('unlocked'), AppColors.warn);
      expect(auditActionColor('marked'), AppColors.warn);
      expect(auditActionColor('impersonate'), const Color(0xFF7C3AED));
      expect(auditActionColor('logout'), AppColors.slate500);
    });

    test('AuditLog parses the contract shape', () {
      final log = AuditLog.from({
        '_id': 'l1',
        'entityType': 'entry',
        'module': 'CNC data entry',
        'sheet': 'cnc',
        'entity': 'r1',
        'machine': 'm1',
        'machineName': '7A',
        'date': '2026-11-20',
        'label': '7A · Bracket · 20/11/2026',
        'action': 'update',
        'changes': [
          {'field': 'okQty', 'label': 'OK Qty', 'from': 390, 'to': 395}
        ],
        'metrics': {'availability': 92.34, 'performance': 88, 'quality': 99.1},
        'flagged': [
          {'metric': 'Performance', 'value': 104.2}
        ],
        'remark': 'Recount',
        'actor': {'id': 'u1', 'model': 'Operator', 'name': 'Mann', 'role': 'Admin'},
        'client': 'app',
        'ip': '10.0.0.5',
        'createdAt': '2026-11-20T09:15:00.000Z',
      });
      expect(log.id, 'l1');
      expect(log.isEntry, isTrue);
      expect(log.changes.single.label, 'OK Qty');
      expect(log.changes.single.to, 395);
      expect(log.actor.name, 'Mann');
      expect(log.clientLabel, 'App');
      expect(log.flagged.single.metric, 'Performance');
      expect(log.createdAt, DateTime.utc(2026, 11, 20, 9, 15));
      expect(auditMetricsLine(log.metrics), 'A 92.3% · P 88% · Q 99.1%');
      expect(auditMetricsLine(null), isNull);
    });

    test('values read well: null → —, lists joined, bools Yes/No', () {
      expect(auditValueText(null), '—');
      expect(auditValueText(''), '—');
      expect(auditValueText(true), 'Yes');
      expect(auditValueText(12.0), '12');
      expect(auditValueText(['a', 'b']), 'a, b');
      expect(auditValueText({'Tool Mark': 6}), 'Tool Mark: 6');
    });
  });
}
