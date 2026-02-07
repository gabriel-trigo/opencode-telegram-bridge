export class BridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class CliCommandError extends BridgeError {}
export class CliInputError extends BridgeError {}
export class CliNotFoundError extends BridgeError {}
export class CliValidationError extends BridgeError {}

export class ConfigError extends BridgeError {}
export class ConfigValidationError extends BridgeError {}

export class OpencodeConfigError extends BridgeError {}
export class OpencodeModelCapabilityError extends BridgeError {}
export class OpencodeModelFormatError extends BridgeError {}
export class OpencodeModelModalitiesError extends BridgeError {}
export class OpencodeRequestError extends BridgeError {}

export class ProjectAliasError extends BridgeError {}
export class ProjectAliasNotFoundError extends ProjectAliasError {}
export class ProjectAliasReservedError extends ProjectAliasError {}
export class ProjectConfigurationError extends BridgeError {}
export class ProjectPathError extends BridgeError {}

export class TelegramFileDownloadError extends BridgeError {}
export class TelegramPhotoSelectionError extends BridgeError {}
