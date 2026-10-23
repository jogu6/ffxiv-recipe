"""Local operator interface. Workers cannot call these operations through the broker."""
import sqlite3
import argparse
import json
import os
import sys
from pathlib import Path
from .common import Rejected
from .policy import Policy
from .queue import Queue


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check-config')
    commands.add_parser('list')
    submit = commands.add_parser('submit')
    submit.add_argument('--project', required=True)
    submit.add_argument('--profile', required=True)
    submit.add_argument('--request-id')
    status = commands.add_parser('status')
    status.add_argument('job')
    latest = commands.add_parser('latest')
    latest.add_argument('--project', required=True)
    latest.add_argument('--profile', required=True)
    recovery = commands.add_parser('recover')
    recovery.add_argument('job')
    recovery.add_argument('--confirm-stopped', action='store_true')
    recovery.add_argument('--reason', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    root = Path(__file__).resolve().parents[1]
    if args.command == 'check-config':
        policy = Policy(root)
        value = {'ok': True, 'projects': {p: {f: policy.revision(p, f) for f in project['profiles']}
                                         for p, project in policy.projects.items()},
                 'workers': sorted(policy.workers)}
    else:
        with Queue(root) as queue:
            if args.command == 'submit':
                value = queue.submit(args.project, args.profile, args.request_id)
            elif args.command == 'status':
                value = queue.status(args.job)
            elif args.command == 'list':
                value = queue.list_jobs()
            elif args.command == 'latest':
                value = queue.latest(args.project, args.profile)
            else:
                value = queue.recover(args.job, args.reason, args.confirm_stopped)
    print(json.dumps(value, ensure_ascii=True, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(1)
    except (Rejected, OSError, ValueError, TypeError, KeyError, sqlite3.Error):
        print('Operation rejected; verify configuration and job state. No request or secret values logged.', file=sys.stderr)
        sys.exit(2)
