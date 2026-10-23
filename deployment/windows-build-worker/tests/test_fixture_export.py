import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import export_windows_fixtures as exporter
import test_windows_worker as windows_cases


class FixtureExportTests(unittest.TestCase):
    def test_export_matches_existing_generator_and_can_be_regenerated(self):
        with tempfile.TemporaryDirectory(prefix='fixture-export-test-') as temporary:
            root = Path(temporary)
            output = root / 'test-export/windows-fixtures'
            with patch.object(exporter, 'ROOT', root):
                files = exporter.export_fixtures(output)
                fixture = json.loads((output / 'fixtures.json').read_bytes())
                self.assertEqual(len(files), 16)
                self.assertFalse(fixture['config']['enabled'])
                self.assertEqual(fixture['config']['ssh']['host'], 'vps.invalid')
                self.assertEqual(fixture['job']['token'], 'fixture-only-not-an-authentication-token')
                reference = windows_cases.WindowsWorkerTests('test_powershell_core_unit_tests_and_static_parser')
                try:
                    reference.setUp()
                    expected = reference.create_core_fixtures()
                    self.assertEqual(fixture['archives'], expected['archives'])
                    self.assertEqual(fixture['vectors'], expected['vectors'])
                    for value in expected['archives'].values():
                        self.assertEqual((output / value['archive']).read_bytes(),
                                         (reference.base / value['archive']).read_bytes())
                finally:
                    reference.doCleanups()
                with self.assertRaises(ValueError):
                    exporter.export_fixtures(output)
                exporter.export_fixtures(output, replace=True)
                (output / 'unrelated.txt').write_text('keep')
                before = {p.name: p.read_bytes() for p in output.iterdir()}
                with self.assertRaises(ValueError):
                    exporter.export_fixtures(output, replace=True)
                self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})

    def test_export_refuses_outside_paths_and_symlinks(self):
        with tempfile.TemporaryDirectory(prefix='fixture-export-test-') as temporary:
            root = Path(temporary)
            (root / 'test-export').mkdir()
            external = root / 'outside'
            external.mkdir()
            (root / 'test-export/link').symlink_to(external, target_is_directory=True)
            with patch.object(exporter, 'ROOT', root):
                for output in (external, root / 'test-export/link/fixtures'):
                    with self.assertRaises(ValueError):
                        exporter.export_fixtures(output, replace=True)
            self.assertEqual(list(external.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
