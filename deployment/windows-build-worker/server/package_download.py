"""Read-only download of one fixed, administrator-built worker package."""
import hashlib
import os
from .common import open_directory, open_file_beneath, require, integer

LIMIT=16*1024*1024


def download(root, offset=0, length=0):
    integer(offset,0,LIMIT);integer(length,0,1048576)
    fd=open_directory(root/'dist')
    try:file_fd=open_file_beneath(fd,'build-worker-windows.zip')
    finally:os.close(fd)
    with os.fdopen(file_fd,'rb') as f:
        size=os.fstat(f.fileno()).st_size
        require(0<size<=LIMIT and offset<=size, message='Invalid deployment package size or offset')
        sha=hashlib.file_digest(f,'sha256').hexdigest()
        f.seek(offset);data=f.read(min(length,size-offset))
        require(os.fstat(f.fileno()).st_size==size,'integrity','Deployment package changed')
    return {'size':size,'sha256':sha,'offset':offset,'chunkSha256':hashlib.sha256(data).hexdigest()},data
