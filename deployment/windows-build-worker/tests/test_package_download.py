import hashlib
from test_worker import Fixture
from server import package_download
from server.common import Rejected


class PackageTests(Fixture):
    def test_fixed_package_range_and_no_arbitrary_paths(self):
        (self.root/'dist').mkdir(mode=0o700)
        content=b'fixed deployment test'
        (self.root/'dist/build-worker-windows.zip').write_bytes(content)
        with self.q() as q:
            metadata,data=package_download.download(self.root,2,5)
            self.assertEqual(data,content[2:7]);self.assertEqual(metadata['sha256'],hashlib.sha256(content).hexdigest())
            code,response,_=self.wire(q,{'op':'download-package','offset':0,'length':10,'path':'../jobs.sqlite3'})
            self.assertEqual(code,2)
            code,response,_=self.wire(q,{'op':'package-info'},worker='unknown')
            self.assertEqual(code,2)

    def test_symlink_and_bad_offsets_refused(self):
        (self.root/'dist').mkdir(mode=0o700)
        outside=self.base/'outside';outside.write_bytes(b'private test bytes')
        (self.root/'dist/build-worker-windows.zip').symlink_to(outside)
        with self.assertRaises(OSError):package_download.download(self.root)
        for offset,length in [(-1,1),(0,1048577)]:
            with self.assertRaises(Rejected):package_download.download(self.root,offset,length)
        self.assertEqual(outside.read_bytes(),b'private test bytes')
