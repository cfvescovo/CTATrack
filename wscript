#
# This file is the default set of rules to compile a Pebble application.
#
# Feel free to customize this to your needs.
#
import json
import os.path

top = '.'
out = 'build'


def _load_dotenv(path):
    values = {}
    if not os.path.exists(path):
        return values

    with open(path, 'r', encoding='utf-8') as fp:
        for raw_line in fp:
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:]
            if '=' not in line:
                continue

            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()

            if ((value.startswith('"') and value.endswith('"')) or
                    (value.startswith("'") and value.endswith("'"))):
                value = value[1:-1]

            values[key] = value

    return values


def _write_pkjs_env_json(ctx):
    env_values = _load_dotenv('.env')
    payload = {
        'TRAIN_API_KEY': env_values.get('TRAIN_API_KEY', ''),
        'BUS_API_KEY': env_values.get('BUS_API_KEY', ''),
    }

    node = ctx.path.find_or_declare('src/pkjs/env.local.json')
    node.write(json.dumps(payload, separators=(',', ':')))


def options(ctx):
    ctx.load('pebble_sdk')


def configure(ctx):
    """
    This method is used to configure your build. ctx.load(`pebble_sdk`) automatically configures
    a build for each valid platform in `targetPlatforms`. Platform-specific configuration: add your
    change after calling ctx.load('pebble_sdk') and make sure to set the correct environment first.
    Universal configuration: add your change prior to calling ctx.load('pebble_sdk').
    """
    ctx.load('pebble_sdk')


def build(ctx):
    _write_pkjs_env_json(ctx)
    ctx.load('pebble_sdk')

    build_worker = os.path.exists('worker_src')
    binaries = []

    cached_env = ctx.env
    for platform in ctx.env.TARGET_PLATFORMS:
        ctx.env = ctx.all_envs[platform]
        ctx.set_group(ctx.env.PLATFORM_NAME)
        app_elf = '{}/pebble-app.elf'.format(ctx.env.BUILD_DIR)
        ctx.pbl_build(source=ctx.path.ant_glob('src/c/**/*.c'), target=app_elf, bin_type='app')

        if build_worker:
            worker_elf = '{}/pebble-worker.elf'.format(ctx.env.BUILD_DIR)
            binaries.append({'platform': platform, 'app_elf': app_elf, 'worker_elf': worker_elf})
            ctx.pbl_build(source=ctx.path.ant_glob('worker_src/c/**/*.c'),
                          target=worker_elf,
                          bin_type='worker')
        else:
            binaries.append({'platform': platform, 'app_elf': app_elf})
    ctx.env = cached_env

    ctx.set_group('bundle')
    ctx.pbl_bundle(binaries=binaries,
                   js=ctx.path.ant_glob(['src/pkjs/**/*.js',
                                         'src/pkjs/**/*.json',
                                         'src/common/**/*.js']),
                   js_entry_file='src/pkjs/index.js')
