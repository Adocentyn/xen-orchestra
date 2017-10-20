import {
  startsWith
} from 'lodash'

import {
  ensureArray,
  extractProperty,
  forEach,
  isArray,
  isEmpty,
  mapFilter,
  mapToArray,
  parseXml
} from './utils'
import {
  isHostRunning,
  isVmHvm,
  isVmRunning,
  parseDateTime
} from './xapi'
import {
  useUpdateSystem
} from './xapi/utils'

// ===================================================================

const {
  defineProperties,
  freeze
} = Object

function link (obj, prop, idField = '$id') {
  const dynamicValue = obj[`$${prop}`]
  if (dynamicValue == null) {
    return dynamicValue // Properly handles null and undefined.
  }

  if (isArray(dynamicValue)) {
    return mapToArray(dynamicValue, idField)
  }

  return dynamicValue[idField]
}

// Parse a string date time to a Unix timestamp (in seconds).
//
// If the value is a number or can be converted as one, it is assumed
// to already be a timestamp and returned.
//
// If there are no data or if the timestamp is 0, returns null.
function toTimestamp (date) {
  if (!date) {
    return null
  }

  const timestamp = +date

  // Not NaN.
  if (timestamp === timestamp) { // eslint-disable-line no-self-compare
    return timestamp
  }

  const ms = parseDateTime(date)
  if (!ms) {
    return null
  }

  return Math.round(ms.getTime() / 1000)
}

// ===================================================================

const TRANSFORMS = {
  pool (obj) {
    const cpuInfo = obj.cpu_info
    return {
      default_SR: link(obj, 'default_SR'),
      HA_enabled: Boolean(obj.ha_enabled),
      master: link(obj, 'master'),
      tags: obj.tags,
      name_description: obj.name_description,
      name_label: obj.name_label || obj.$master.name_label,
      xosanPackInstallationTime: toTimestamp(obj.other_config.xosan_pack_installation_time),
      cpus: {
        cores: cpuInfo && +cpuInfo.cpu_count,
        sockets: cpuInfo && +cpuInfo.socket_count
      }

      // TODO
      // - ? networks = networksByPool.items[pool.id] (network.$pool.id)
      // - hosts = hostsByPool.items[pool.id] (host.$pool.$id)
      // - patches = poolPatchesByPool.items[pool.id] (poolPatch.$pool.id)
      // - SRs = srsByContainer.items[pool.id] (sr.$container.id)
      // - templates = vmTemplatesByContainer.items[pool.id] (vmTemplate.$container.$id)
      // - VMs = vmsByContainer.items[pool.id] (vm.$container.id)
      // - $running_hosts = runningHostsByPool.items[pool.id] (runningHost.$pool.id)
      // - $running_VMs = runningVmsByPool.items[pool.id] (runningHost.$pool.id)
      // - $VMs = vmsByPool.items[pool.id] (vm.$pool.id)
    }
  },

  // -----------------------------------------------------------------

  host (obj) {
    const {
      $metrics: metrics,
      other_config: otherConfig
    } = obj

    const isRunning = isHostRunning(obj)
    const { software_version } = obj
    let supplementalPacks, patches

    if (useUpdateSystem(obj)) {
      supplementalPacks = []
      patches = []

      forEach(obj.$updates, update => {
        const formattedUpdate = {
          name: update.name_label,
          description: update.name_description,
          author: update.key.split('-')[3],
          version: update.version,
          guidance: update.after_apply_guidance,
          hosts: link(update, 'hosts'),
          vdi: link(update, 'vdi'),
          size: update.installation_size
        }

        if (startsWith(update.name_label, 'XS')) {
          patches.push(formattedUpdate)
        } else {
          supplementalPacks.push(formattedUpdate)
        }
      })
    }

    const cpuInfo = obj.cpu_info

    return {
      // Deprecated
      CPUs: cpuInfo,

      address: obj.address,
      bios_strings: obj.bios_strings,
      build: obj.software_version.build_number,
      enabled: Boolean(obj.enabled),
      cpus: {
        cores: cpuInfo && +cpuInfo.cpu_count,
        sockets: cpuInfo && +cpuInfo.socket_count
      },
      current_operations: obj.current_operations,
      hostname: obj.hostname,
      iSCSI_name: otherConfig.iscsi_iqn || null,
      license_params: obj.license_params,
      license_server: obj.license_server,
      license_expiry: toTimestamp(obj.license_params.expiry),
      name_description: obj.name_description,
      name_label: obj.name_label,
      memory: (function () {
        if (metrics) {
          const free = +metrics.memory_free
          const total = +metrics.memory_total

          return {
            usage: total - free,
            size: total
          }
        }

        return {
          usage: 0,
          size: 0,

          // Deprecated
          total: 0
        }
      })(),
      patches: patches || link(obj, 'patches'),
      powerOnMode: obj.power_on_mode,
      power_state: metrics
        ? (isRunning ? 'Running' : 'Halted')
        : 'Unknown',
      startTime: toTimestamp(otherConfig.boot_time),
      supplementalPacks: supplementalPacks ||
        mapFilter(software_version, (value, key) => {
          let author, name
          if (([ author, name ] = key.split(':')).length === 2) {
            const [ description, version ] = value.split(', ')
            return {
              name,
              description,
              author,
              version: version.split(' ')[1]
            }
          }
        }),
      agentStartTime: toTimestamp(otherConfig.agent_start_time),
      rebootRequired: !isEmpty(obj.updates_requiring_reboot),
      tags: obj.tags,
      version: obj.software_version.product_version,

      // TODO: dedupe.
      PIFs: link(obj, 'PIFs'),
      $PIFs: link(obj, 'PIFs'),
      PCIs: link(obj, 'PCIs'),
      $PCIs: link(obj, 'PCIs'),
      PGPUs: link(obj, 'PGPUs'),
      $PGPUs: link(obj, 'PGPUs'),

      $PBDs: link(obj, 'PBDs')

      // TODO:
      // - controller = vmControllersByContainer.items[host.id]
      // - SRs = srsByContainer.items[host.id]
      // - tasks = tasksByHost.items[host.id]
      // - templates = vmTemplatesByContainer.items[host.id]
      // - VMs = vmsByContainer.items[host.id]
      // - $vCPUs = sum(host.VMs, vm => host.CPUs.number)
    }
  },

  // -----------------------------------------------------------------

  vm (obj) {
    const {
      $guest_metrics: guestMetrics,
      $metrics: metrics,
      other_config: otherConfig
    } = obj

    const isHvm = isVmHvm(obj)
    const isRunning = isVmRunning(obj)
    const xenTools = (() => {
      if (!isRunning || !metrics) {
        // Unknown status, returns nothing.
        return
      }

      if (!guestMetrics) {
        return false
      }

      const { major, minor } = guestMetrics.PV_drivers_version
      const [ hostMajor, hostMinor ] = (obj.$resident_on || obj.$pool.$master)
        .software_version
        .product_version
        .split('.')

      return major >= hostMajor && minor >= hostMinor
        ? 'up to date'
        : 'out of date'
    })()

    let resourceSet = otherConfig['xo:resource_set']
    if (resourceSet) {
      try {
        resourceSet = JSON.parse(resourceSet)
      } catch (_) {
        resourceSet = undefined
      }
    }

    const vm = {
      // type is redefined after for controllers/, templates &
      // snapshots.
      type: 'VM',

      addresses: (guestMetrics && guestMetrics.networks) || null,
      affinityHost: link(obj, 'affinity'),
      auto_poweron: Boolean(otherConfig.auto_poweron),
      boot: obj.HVM_boot_params,
      CPUs: {
        max: +obj.VCPUs_max,
        number: (
          isRunning && metrics && xenTools
            ? +metrics.VCPUs_number
            : +obj.VCPUs_at_startup
        )
      },
      current_operations: obj.current_operations,
      docker: (function () {
        const monitor = otherConfig['xscontainer-monitor']
        if (!monitor) {
          return
        }

        if (monitor === 'False') {
          return {
            enabled: false
          }
        }

        const {
          docker_ps: process,
          docker_info: info,
          docker_version: version
        } = otherConfig

        return {
          enabled: true,
          info: info && parseXml(info).docker_info,
          containers: ensureArray(process && parseXml(process).docker_ps.item),
          process: process && parseXml(process).docker_ps, // deprecated (only used in v4)
          version: version && parseXml(version).docker_version
        }
      })(),

      // TODO: there is two possible value: "best-effort" and "restart"
      high_availability: Boolean(obj.ha_restart_priority),

      memory: (function () {
        const dynamicMin = +obj.memory_dynamic_min
        const dynamicMax = +obj.memory_dynamic_max
        const staticMin = +obj.memory_static_min
        const staticMax = +obj.memory_static_max

        const memory = {
          dynamic: [ dynamicMin, dynamicMax ],
          static: [ staticMin, staticMax ]
        }

        const gmMemory = guestMetrics && guestMetrics.memory

        if (!isRunning) {
          memory.size = dynamicMax
        } else if (gmMemory && gmMemory.used) {
          memory.usage = +gmMemory.used
          memory.size = +gmMemory.total
        } else if (metrics) {
          memory.size = +metrics.memory_actual
        } else {
          memory.size = dynamicMax
        }

        return memory
      })(),
      installTime: metrics && toTimestamp(metrics.install_time),
      name_description: obj.name_description,
      name_label: obj.name_label,
      other: otherConfig,
      os_version: (guestMetrics && guestMetrics.os_version) || null,
      power_state: obj.power_state,
      resourceSet,
      snapshots: link(obj, 'snapshots'),
      startTime: metrics && toTimestamp(metrics.start_time),
      tags: obj.tags,
      VIFs: link(obj, 'VIFs'),
      virtualizationMode: isHvm ? 'hvm' : 'pv',

      // <=> Are the Xen Server tools installed?
      //
      // - undefined: unknown status
      // - false: not optimized
      // - 'out of date': optimized but drivers should be updated
      // - 'up to date': optimized
      xenTools,

      $container: (
        isRunning
          ? link(obj, 'resident_on')
          : link(obj, 'pool') // TODO: handle local VMs (`VM.get_possible_hosts()`).
      ),
      $VBDs: link(obj, 'VBDs'),

      // TODO: dedupe
      VGPUs: link(obj, 'VGPUs'),
      $VGPUs: link(obj, 'VGPUs')
    }

    if (isHvm) {
      ({
        vga: vm.vga = 'cirrus',
        videoram: vm.videoram = 4
      } = obj.platform)
    }

    const coresPerSocket = obj.platform['cores-per-socket']
    if (coresPerSocket !== undefined) {
      vm.coresPerSocket = +coresPerSocket
    }

    if (obj.is_control_domain) {
      vm.type += '-controller'
    } else if (obj.is_a_snapshot) {
      vm.type += '-snapshot'

      vm.snapshot_time = toTimestamp(obj.snapshot_time)
      vm.$snapshot_of = link(obj, 'snapshot_of')
    } else if (obj.is_a_template) {
      vm.type += '-template'

      if (obj.other_config.default_template === 'true') {
        vm.id = obj.$ref // use refs for templates as they
      }

      vm.CPUs.number = +obj.VCPUs_at_startup
      vm.template_info = {
        arch: otherConfig['install-arch'],
        disks: (function () {
          const {disks: xml} = otherConfig
          let data
          if (!xml || !(data = parseXml(xml)).provision) {
            return []
          }

          const disks = ensureArray(data.provision.disk)
          forEach(disks, function normalize (disk) {
            disk.bootable = disk.bootable === 'true'
            disk.size = +disk.size
            disk.SR = extractProperty(disk, 'sr')
          })

          return disks
        })(),
        install_methods: (function () {
          const methods = otherConfig['install-methods']

          return methods ? methods.split(',') : []
        })(),
        install_repository: otherConfig['install-repository']
      }
    }

    let tmp
    if ((tmp = obj.VCPUs_params)) {
      tmp.cap && (vm.cpuCap = +tmp.cap)
      tmp.weight && (vm.cpuWeight = +tmp.weight)
    }

    if (!isHvm) {
      vm.PV_args = obj.PV_args
    }

    return vm
  },

  // -----------------------------------------------------------------

  sr (obj) {
    return {
      type: 'SR',

      content_type: obj.content_type,

      // TODO: Should it replace usage?
      physical_usage: +obj.physical_utilisation,

      name_description: obj.name_description,
      name_label: obj.name_label,
      size: +obj.physical_size,
      shared: Boolean(obj.shared),
      SR_type: obj.type,
      tags: obj.tags,
      usage: +obj.virtual_allocation,
      VDIs: link(obj, 'VDIs'),
      other_config: obj.other_config,
      sm_config: obj.sm_config,

      $container: (
        obj.shared || !obj.$PBDs[0]
          ? link(obj, 'pool')
          : link(obj.$PBDs[0], 'host')
      ),
      $PBDs: link(obj, 'PBDs')
    }
  },

  // -----------------------------------------------------------------

  pbd (obj) {
    return {
      type: 'PBD',

      attached: Boolean(obj.currently_attached),
      host: link(obj, 'host'),
      SR: link(obj, 'SR'),
      device_config: obj.device_config
    }
  },

  // -----------------------------------------------------------------

  pif (obj) {
    const metrics = obj.$metrics

    return {
      type: 'PIF',

      attached: Boolean(obj.currently_attached),
      isBondMaster: !isEmpty(obj.bond_master_of),
      device: obj.device,
      deviceName: metrics && metrics.device_name,
      dns: obj.DNS,
      disallowUnplug: Boolean(obj.disallow_unplug),
      gateway: obj.gateway,
      ip: obj.IP,
      mac: obj.MAC,
      management: Boolean(obj.management), // TODO: find a better name.
      carrier: Boolean(metrics && metrics.carrier),
      mode: obj.ip_configuration_mode,
      mtu: +obj.MTU,
      netmask: obj.netmask,
      // A non physical PIF is a "copy" of an existing physical PIF (same device)
      // A physical PIF cannot be unplugged
      physical: Boolean(obj.physical),
      vlan: +obj.VLAN,
      $host: link(obj, 'host'),
      $network: link(obj, 'network')
    }
  },

  // -----------------------------------------------------------------

  vdi (obj) {
    const vdi = {
      type: 'VDI',

      name_description: obj.name_description,
      name_label: obj.name_label,
      size: +obj.virtual_size,
      snapshots: link(obj, 'snapshots'),
      tags: obj.tags,
      usage: +obj.physical_utilisation,

      $SR: link(obj, 'SR'),
      $VBDs: link(obj, 'VBDs')
    }

    if (obj.is_a_snapshot) {
      vdi.type += '-snapshot'
      vdi.snapshot_time = toTimestamp(obj.snapshot_time)
      vdi.$snapshot_of = link(obj, 'snapshot_of')
    }

    if (!obj.managed) {
      vdi.type += '-unmanaged'
    }

    return vdi
  },

  // -----------------------------------------------------------------

  vbd (obj) {
    return {
      type: 'VBD',

      attached: Boolean(obj.currently_attached),
      bootable: Boolean(obj.bootable),
      device: obj.device || null,
      is_cd_drive: obj.type === 'CD',
      position: obj.userdevice,
      read_only: obj.mode === 'RO',
      VDI: link(obj, 'VDI'),
      VM: link(obj, 'VM')
    }
  },

  // -----------------------------------------------------------------

  vif (obj) {
    return {
      type: 'VIF',

      allowedIpv4Addresses: obj.ipv4_allowed,
      allowedIpv6Addresses: obj.ipv6_allowed,
      attached: Boolean(obj.currently_attached),
      device: obj.device, // TODO: should it be cast to a number?
      MAC: obj.MAC,
      MTU: +obj.MTU,

      $network: link(obj, 'network'),
      $VM: link(obj, 'VM')
    }
  },

  // -----------------------------------------------------------------

  network (obj) {
    return {
      bridge: obj.bridge,
      defaultIsLocked: obj.default_locking_mode === 'disabled',
      MTU: +obj.MTU,
      name_description: obj.name_description,
      name_label: obj.name_label,
      other_config: obj.other_config,
      tags: obj.tags,
      PIFs: link(obj, 'PIFs'),
      VIFs: link(obj, 'VIFs')
    }
  },

  // -----------------------------------------------------------------

  message (obj) {
    return {
      body: obj.body,
      name: obj.name,
      time: toTimestamp(obj.timestamp),

      $object: obj.obj_uuid // Special link as it is already an UUID.
    }
  },

  // -----------------------------------------------------------------

  task (obj) {
    return {
      created: toTimestamp(obj.created),
      current_operations: obj.current_operations,
      finished: toTimestamp(obj.finished),
      name_description: obj.name_description,
      name_label: obj.name_label,
      progress: +obj.progress,
      result: obj.result,
      status: obj.status,

      $host: link(obj, 'resident_on')
    }
  },

  // -----------------------------------------------------------------

  host_patch (obj) {
    return {
      applied: Boolean(obj.applied),
      time: toTimestamp(obj.timestamp_applied),
      pool_patch: link(obj, 'pool_patch', '$ref'),

      $host: link(obj, 'host')
    }
  },

  // -----------------------------------------------------------------

  pool_patch (obj) {
    return {
      id: obj.$ref,

      applied: Boolean(obj.pool_applied),
      description: obj.name_description,
      guidance: obj.after_apply_guidance,
      name: obj.name_label,
      size: +obj.size,
      uuid: obj.uuid,

      // TODO: what does it mean, should we handle it?
      // version: obj.version,

      // TODO: host.[$]pool_patches ←→ pool.[$]host_patches
      $host_patches: link(obj, 'host_patches')
    }
  },

  // -----------------------------------------------------------------

  pci (obj) {
    return {
      type: 'PCI',

      class_name: obj.class_name,
      device_name: obj.device_name,
      pci_id: obj.pci_id,

      $host: link(obj, 'host')
    }
  },

  // -----------------------------------------------------------------

  pgpu (obj) {
    return {
      type: 'PGPU',

      pci: link(obj, 'PCI'),

      // TODO: dedupe.
      host: link(obj, 'host'),
      $host: link(obj, 'host'),
      vgpus: link(obj, 'resident_VGPUs'),
      $vgpus: link(obj, 'resident_VGPUs')
    }
  },

  // -----------------------------------------------------------------

  vgpu (obj) {
    return {
      type: 'VGPU',

      currentlyAttached: Boolean(obj.currently_attached),
      device: obj.device,
      gpuGroup: link(obj, 'GPU_group'),
      resident_on: link(obj, 'resident_on'),
      vgpuType: link(obj, 'VGPU_type'),
      $pgpu: link(obj, 'PGPU'),
      vm: link(obj, 'VM')
    }
  },

  // -----------------------------------------------------------------

  gpuGroup (obj) {
    return {
      type: 'GPU_group',

      allocation: obj.allocation_algorithm,
      supportedVgpuTypes: obj.supported_VGPU_types,
      enabledVgpuTypes: obj.enabled_VGPU_types,
      name_description: obj.name_description,
      name_label: obj.name_label,
      other_config: obj.other_config,
      $vgpus: link(obj, 'VGPUs'),
      $pgpus: link(obj, 'PGPUs')
    }
  },

  // -----------------------------------------------------------------

  vgpuType (obj) {
    return {
      type: 'VGPU_type',

      experimental: Boolean(obj.experimental),
      maxHeads: obj.max_heads,
      modelName: obj.model_name,
      vendorName: obj.vendor_name,
      $vgpus: link(obj, 'VGPUs'),
      $pgpu: link(obj, 'PGPU')
    }
  }
}

// ===================================================================

export default xapiObj => {
  const transform = TRANSFORMS[xapiObj.$type.toLowerCase()]
  if (!transform) {
    return
  }

  const xoObj = transform(xapiObj)
  if (!xoObj) {
    return
  }

  if (!('id' in xoObj)) {
    xoObj.id = xapiObj.$id
  }
  if (!('type' in xoObj)) {
    xoObj.type = xapiObj.$type
  }
  if (
    'uuid' in xapiObj &&
    !('uuid' in xoObj)
  ) {
    xoObj.uuid = xapiObj.uuid
  }
  xoObj.$pool = xapiObj.$pool.$id
  xoObj.$poolId = xoObj.$pool // TODO: deprecated, remove when no longer used in xo-web

  // Internal properties.
  defineProperties(xoObj, {
    _xapiId: {
      value: xapiObj.$id
    },
    _xapiRef: {
      value: xapiObj.$ref
    }
  })

  // Freezes and returns the new object.
  return freeze(xoObj)
}
