import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {DivergenceMeterAccessory} from './platformAccessory';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DivergenceMeterPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevice();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevice() {
    const displayName = 'Divergence Meter';
    const uuid = this.api.hap.uuid.generate('homebridge:divergence-meter');

    // See if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      // The accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      // Create the accessory handler for the restored accessory
      new DivergenceMeterAccessory(this, existingAccessory, this.config);

    } else {
      // The accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', displayName);

      // Create a new accessory
      const accessory = new this.api.platformAccessory(displayName, uuid);

      // Create the accessory handler for the newly create accessory
      new DivergenceMeterAccessory(this, accessory, this.config);

      // Television should be published as external accessories that the user adds manually
      // There will be problems (e.g. input sources do not have correct names) without going through the setup process
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    }
  }
}
