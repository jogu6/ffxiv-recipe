from pathlib import Path
from .common import (fields, identifier, integer, portable_path, unique_paths, require,
                     read_private_json, digest, hexhash)


class Policy:
    def __init__(self, root):
        self.root = Path(root)
        projects = read_private_json(root, 'config/projects.json')
        workers = read_private_json(root, 'config/workers.json')
        fields(projects, ('schemaVersion', 'projects'))
        fields(workers, ('schemaVersion', 'workers'))
        require(type(projects['schemaVersion']) is int and type(workers['schemaVersion']) is int
                and projects['schemaVersion'] == workers['schemaVersion'] == 1, message='Unknown schema')
        require(type(projects['projects']) is dict and type(workers['workers']) is dict)
        self.projects = projects['projects']
        self.workers = workers['workers']
        for project_id, project in self.projects.items():
            identifier(project_id)
            fields(project, ('sourceRoot', 'include', 'extraFiles', 'exclude', 'limits', 'profiles'))
            source = project['sourceRoot']
            require(type(source) is str and Path(source).is_absolute()
                    and '..' not in Path(source).parts, message='Invalid source root')
            # Worker runtime/configuration cannot be submitted as project source.
            source_path = Path(source)
            require(not source_path.is_relative_to(self.root)
                    and not self.root.is_relative_to(source_path), message='Source overlaps worker root')
            for key in ('include', 'extraFiles', 'exclude'):
                require(type(project[key]) is list and len(project[key]) <= 1000)
                unique_paths(project[key])
            require(project['include'], message='Explicit source include paths are required')
            limits = project['limits']
            fields(limits, ('maxFiles', 'maxFileBytes', 'maxSourceBytes'))
            integer(limits['maxFiles'], 1, 20000)
            integer(limits['maxFileBytes'], 1, 128 * 1024**2)
            integer(limits['maxSourceBytes'], 1, 1024**3)
            require(type(project['profiles']) is dict)
            for profile_id, definition in project['profiles'].items():
                identifier(profile_id)
                fields(definition, ('steps', 'artifacts', 'timeoutSeconds'))
                integer(definition['timeoutSeconds'], 1, 86400)
                require(type(definition['steps']) is list and 0 < len(definition['steps']) <= 32)
                for step in definition['steps']:
                    fields(step, ('tool', 'args', 'cwd'))
                    identifier(step['tool'])
                    require(type(step['args']) is list and len(step['args']) <= 100
                            and all(type(s) is str and len(s) <= 4096 and '\x00' not in s
                                    for s in step['args']))
                    if step['cwd'] != '.':
                        portable_path(step['cwd'])
                artifacts = definition['artifacts']
                require(type(artifacts) is list and 0 < len(artifacts) <= 32)
                for artifact in artifacts:
                    fields(artifact, ('path', 'maxBytes'))
                    portable_path(artifact['path'])
                    integer(artifact['maxBytes'], 1, 512 * 1024**2)
                unique_paths([a['path'] for a in artifacts])
                require(sum(a['maxBytes'] for a in artifacts) <= 1024**3,
                        message='Artifact budget too large')
        for worker_id, worker in self.workers.items():
            identifier(worker_id)
            fields(worker, ('profiles',))
            require(type(worker['profiles']) is list and len(worker['profiles']) <= 1000)
            seen = set()
            for item in worker['profiles']:
                self.check_capability(item)
                pair = (item['projectId'], item['profileId'])
                require(pair not in seen, message='Duplicate worker capability')
                seen.add(pair)

    def profile(self, project_id, profile_id):
        identifier(project_id)
        identifier(profile_id)
        require(project_id in self.projects, 'denied', 'Project is not approved')
        profiles = self.projects[project_id]['profiles']
        require(profile_id in profiles, 'denied', 'Profile is not approved')
        return profiles[profile_id]

    def revision(self, project_id, profile_id):
        return digest(self.profile(project_id, profile_id))

    def check_capability(self, item):
        fields(item, ('projectId', 'profileId', 'revision'))
        hexhash(item['revision'])
        require(item['revision'] == self.revision(item['projectId'], item['profileId']),
                'profile_mismatch', 'Approved profile revision does not match')

    def worker(self, worker_id):
        identifier(worker_id)
        require(worker_id in self.workers, 'denied', 'Worker is not approved')
        return self.workers[worker_id]

    def capabilities(self, worker_id, items):
        approved = self.worker(worker_id)['profiles']
        require(type(items) is list and len(items) <= 1000)
        seen = set()
        for item in items:
            self.check_capability(item)
            require(item in approved, 'denied', 'Worker profile is not approved')
            pair = (item['projectId'], item['profileId'])
            require(pair not in seen, message='Duplicate capability')
            seen.add(pair)
        return items
