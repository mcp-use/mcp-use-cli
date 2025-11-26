import {ChatOpenAI, AzureChatOpenAI} from '@langchain/openai';
import {ChatAnthropic} from '@langchain/anthropic';
import {ChatGoogleGenerativeAI} from '@langchain/google-genai';
import {ChatVertexAI} from '@langchain/google-vertexai';
import {ChatMistralAI} from '@langchain/mistralai';
import {ChatGroq} from '@langchain/groq';
import {ChatCohere} from '@langchain/cohere';
import {ChatFireworks} from '@langchain/community/chat_models/fireworks';
import {ChatPerplexity} from '@langchain/community/chat_models/perplexity';
import {ChatOllama} from '@langchain/ollama';
import {ChatTogetherAI} from '@langchain/community/chat_models/togetherai';
import {ChatDeepSeek} from '@langchain/deepseek';
import {ChatXAI} from '@langchain/xai';
import {SecureStorage, StoredConfig} from '../storage.js';
import type {CommandResult} from '../types.js';
import type {BaseLanguageModelInterface} from '@langchain/core/language_models/base';

export type ProviderKey = keyof typeof PROVIDERS;

export interface LLMConfig {
	provider: ProviderKey;
	model: string;
	temperature?: number;
	maxTokens?: number;
}

const PROVIDERS = {
	openai: {
		envVar: 'OPENAI_API_KEY',
		defaultModel: 'gpt-4o',
		factory: (key: string, cfg: LLMConfig) => {
			const baseURL = process.env['OPENAI_BASE_URL'] || process.env['OPENAI_API_BASE'];
			const config: any = {
				openAIApiKey: key,
				modelName: cfg.model,
			};
			if (baseURL) {
				config.configuration = {
					baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL,
				};
			}
			return new ChatOpenAI(config);
		},
	},
	localopenai: {
		envVar: 'LOCAL_OPENAI_API_KEY',
		defaultModel: 'gpt-3.5-turbo',
		factory: (key: string, cfg: LLMConfig) => {
			const baseURL = process.env['LOCAL_OPENAI_BASE_URL'] || 'http://localhost:1234/v1';
			const config: any = {
				openAIApiKey: key || 'local-api-key',
				modelName: cfg.model,
				configuration: {
					baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL,
				},
			};
			return new ChatOpenAI(config);
		},
	},
	azureopenai: {
		envVar: 'AZURE_OPENAI_API_KEY',
		defaultModel: 'gpt-4o',
		factory: (key: string, cfg: LLMConfig) =>
			new AzureChatOpenAI({azureOpenAIApiKey: key, modelName: cfg.model}),
	},
	anthropic: {
		envVar: 'ANTHROPIC_API_KEY',
		defaultModel: 'claude-3-5-sonnet-20240620',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatAnthropic({anthropicApiKey: key, modelName: cfg.model}),
	},
	gemini: {
		envVar: 'GOOGLE_API_KEY',
		defaultModel: 'gemini-1.5-pro',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatGoogleGenerativeAI({apiKey: key, model: cfg.model}),
	},
	vertex: {
		envVar: 'GOOGLE_APPLICATION_CREDENTIALS',
		defaultModel: 'gemini-1.5-flash',
		factory: (_key: string, cfg: LLMConfig) =>
			new ChatVertexAI({model: cfg.model}),
	},
	mistral: {
		envVar: 'MISTRAL_API_KEY',
		defaultModel: 'mistral-large-latest',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatMistralAI({apiKey: key, modelName: cfg.model}),
	},
	groq: {
		envVar: 'GROQ_API_KEY',
		defaultModel: 'llama-3.1-70b-versatile',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatGroq({apiKey: key, model: cfg.model}),
	},
	cohere: {
		envVar: 'COHERE_API_KEY',
		defaultModel: 'command-r-plus',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatCohere({apiKey: key, model: cfg.model}),
	},
	fireworks: {
		envVar: 'FIREWORKS_API_KEY',
		defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatFireworks({apiKey: key, model: cfg.model}),
	},
	perplexity: {
		envVar: 'PERPLEXITY_API_KEY',
		defaultModel: 'pplx-70b-online',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatPerplexity({apiKey: key, model: cfg.model}),
	},
	ollama: {
		envVar: 'OLLAMA_HOST',
		defaultModel: 'llama3',
		factory: (_key: string, cfg: LLMConfig) =>
			new ChatOllama({baseUrl: process.env['OLLAMA_HOST'], model: cfg.model}),
	},
	together: {
		envVar: 'TOGETHER_API_KEY',
		defaultModel: 'mistralai/Mixtral-8x22B-Instruct-v0.1',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatTogetherAI({apiKey: key, model: cfg.model}),
	},
	deepseek: {
		envVar: 'DEEPSEEK_API_KEY',
		defaultModel: 'deepseek-chat',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatDeepSeek({apiKey: key, model: cfg.model}),
	},
	xai: {
		envVar: 'XAI_API_KEY',
		defaultModel: 'grok-1.5',
		factory: (key: string, cfg: LLMConfig) =>
			new ChatXAI({apiKey: key, model: cfg.model}),
	},
} as const;

export class LLMService {
	private currentLLMConfig: LLMConfig | null = null;
	private sessionApiKeys: Record<string, string> = {};
	private persistentConfig: StoredConfig;

	constructor() {
		this.persistentConfig = SecureStorage.loadConfig();
		this.initializeDefaultProvider();
	}

	private initializeDefaultProvider() {
		if (this.persistentConfig.lastModel) {
			const lastModel = this.persistentConfig.lastModel as LLMConfig;
			const providerInfo = PROVIDERS[lastModel.provider as ProviderKey];
			if (providerInfo) {
				const envVar = providerInfo.envVar;
				if (envVar && this.getApiKey(envVar)) {
					this.currentLLMConfig = {
						provider: lastModel.provider,
						model: lastModel.model,
						temperature: lastModel.temperature ?? 0.7,
						maxTokens: lastModel.maxTokens,
					};
					return;
				}
			}
		}

		for (const [providerName, providerInfo] of Object.entries(PROVIDERS)) {
			if (this.getApiKey(providerInfo.envVar)) {
				this.currentLLMConfig = {
					provider: providerName as ProviderKey,
					model: providerInfo.defaultModel,
					temperature: 0.7,
				};
				return;
			}
		}

		this.currentLLMConfig = null;
	}

	private getApiKey(envVar: string): string | undefined {
		return (
			this.sessionApiKeys[envVar] ||
			this.persistentConfig.apiKeys[envVar] ||
			process.env[envVar]
		);
	}

	getAvailableProviders(): string[] {
		return Object.entries(PROVIDERS)
			.filter(([, providerInfo]) => this.getApiKey(providerInfo.envVar))
			.map(([providerName]) => providerName);
	}

	getAllProviderNames(): string[] {
		return Object.keys(PROVIDERS);
	}

	isAnyProviderAvailable(): boolean {
		return this.getAvailableProviders().length > 0;
	}

	getAvailableModels(provider?: string): Record<string, string[]> | string[] {
		const models: Record<string, string[]> = {};
		for (const [key, value] of Object.entries(PROVIDERS)) {
			models[key] = [value.defaultModel];
		}
		if (provider && models[provider]) {
			return models[provider];
		}
		return models;
	}

	getCurrentConfig(): LLMConfig | null {
		return this.currentLLMConfig ? {...this.currentLLMConfig} : null;
	}

	setModel(
		provider: string,
		model: string,
	): {
		success: boolean;
		message: string;
		requiresApiKey?: boolean;
		envVar?: string;
	} {
		if (!Object.keys(PROVIDERS).includes(provider)) {
			return {success: false, message: `Unknown provider: ${provider}`};
		}

		const availableProviders = this.getAvailableProviders();
		if (!availableProviders.includes(provider)) {
			const providerInfo = PROVIDERS[provider as ProviderKey];
			return {
				success: false,
				message: `API key not found for ${provider}`,
				requiresApiKey: true,
				envVar: providerInfo.envVar,
			};
		}

		this.currentLLMConfig = {
			provider: provider as ProviderKey,
			model,
			temperature: this.currentLLMConfig?.temperature || 0.7,
			maxTokens: this.currentLLMConfig?.maxTokens,
		};

		this.persistentConfig.lastModel = this.currentLLMConfig;
		SecureStorage.saveConfig(this.persistentConfig);

		return {success: true, message: `Switched to ${provider} ${model}`};
	}

	setTemperature(temperature: number): {success: boolean; message: string} {
		if (!this.currentLLMConfig) {
			return {success: false, message: 'No model configured'};
		}
		if (temperature < 0 || temperature > 2) {
			return {
				success: false,
				message: 'Temperature must be between 0.0 and 2.0',
			};
		}
		this.currentLLMConfig.temperature = temperature;
		return {success: true, message: `Temperature set to ${temperature}`};
	}

	setMaxTokens(maxTokens: number): {success: boolean; message: string} {
		if (!this.currentLLMConfig) {
			return {success: false, message: 'No model configured'};
		}
		if (maxTokens < 1) {
			return {success: false, message: 'Max tokens must be a positive integer'};
		}
		this.currentLLMConfig.maxTokens = maxTokens;
		return {success: true, message: `Max tokens set to ${maxTokens}`};
	}

	validateApiKey(
		_provider: string,
		apiKey: string,
	): {valid: boolean; message: string} {
		if (!apiKey || apiKey.trim().length === 0) {
			return {valid: false, message: 'API key cannot be empty'};
		}
		// Basic validation can be improved per provider if needed
		return {valid: true, message: ''};
	}

	setApiKey(
		provider: string,
		apiKey: string,
		shouldAutoSelect = false,
	): {success: boolean; message: string; autoSelected?: LLMConfig} {
		const validationResult = this.validateApiKey(provider, apiKey);
		if (!validationResult.valid) {
			return {success: false, message: validationResult.message};
		}

		const providerInfo = PROVIDERS[provider as ProviderKey];
		if (!providerInfo) {
			return {success: false, message: `Invalid provider: ${provider}`};
		}
		const envVar = providerInfo.envVar;

		this.persistentConfig.apiKeys[envVar] = apiKey;
		SecureStorage.saveConfig(this.persistentConfig);

		let autoSelected: LLMConfig | undefined;
		if (shouldAutoSelect && !this.currentLLMConfig) {
			this.currentLLMConfig = {
				provider: provider as ProviderKey,
				model: providerInfo.defaultModel,
				temperature: 0.7,
			};
			autoSelected = this.currentLLMConfig;
		}
		return {
			success: true,
			message: `${provider} API key set`,
			autoSelected,
		};
	}

	clearApiKeys(): void {
		this.sessionApiKeys = {};
		this.persistentConfig.apiKeys = {};
		this.persistentConfig.lastModel = undefined;
		this.currentLLMConfig = null;
		SecureStorage.saveConfig(this.persistentConfig);
	}

	maskApiKey(apiKey: string): string {
		if (apiKey.length <= 8) {
			return '*'.repeat(apiKey.length);
		}
		const start = apiKey.substring(0, 4);
		const end = apiKey.substring(apiKey.length - 4);
		const middle = '*'.repeat(Math.min(12, apiKey.length - 8));
		return `${start}${middle}${end}`;
	}

	getApiKeyStatus(): Record<
		string,
		{status: string; source: string; masked: string}
	> {
		const status: Record<
			string,
			{status: string; source: string; masked: string}
		> = {};
		for (const [providerName, providerInfo] of Object.entries(PROVIDERS)) {
			const envVar = providerInfo.envVar;
			const hasEnvKey = !!process.env[envVar];
			const hasSessionKey = !!this.sessionApiKeys[envVar];
			const hasPersistentKey = !!this.persistentConfig.apiKeys[envVar];

			if (hasSessionKey) {
				const key = this.sessionApiKeys[envVar]!;
				status[providerName] = {
					status: 'set',
					source: 'session',
					masked: this.maskApiKey(key),
				};
			} else if (hasPersistentKey) {
				const key = this.persistentConfig.apiKeys[envVar]!;
				status[providerName] = {
					status: 'set',
					source: 'stored',
					masked: this.maskApiKey(key),
				};
			} else if (hasEnvKey) {
				const key = process.env[envVar]!;
				status[providerName] = {
					status: 'set',
					source: 'env',
					masked: this.maskApiKey(key),
				};
			} else {
				status[providerName] = {
					status: 'not set',
					source: 'none',
					masked: '',
				};
			}
		}
		return status;
	}

	createLLM(): BaseLanguageModelInterface | null {
		if (!this.currentLLMConfig) {
			return null;
		}

		const config = this.currentLLMConfig;
		const providerInfo = PROVIDERS[config.provider];
		if (!providerInfo) {
			throw new Error(`Unsupported provider: ${config.provider}`);
		}
		const apiKey = this.getApiKey(providerInfo.envVar);
		if (!apiKey && providerInfo.envVar !== 'OLLAMA_HOST') {
			throw new Error(
				`${providerInfo.envVar} is required for ${config.provider} models. Use /setkey ${config.provider} <your-key>`,
			);
		}
		const llm = providerInfo.factory(apiKey!, config);
		const llmWithOptions = llm as BaseLanguageModelInterface & {
			temperature?: number;
			maxTokens?: number;
		};
		llmWithOptions.temperature = config.temperature ?? 0.7;
		llmWithOptions.maxTokens = config.maxTokens;
		return llmWithOptions;
	}

	/**
	 * Handles the /model command to select a provider and model.
	 * @param args - Array of arguments where args[0] is provider and args[1] is model
	 * @returns A CommandResult with success/error status and prompts for API key if needed
	 */
	handleModelCommand(args: string[]): CommandResult {
		if (args.length === 0) {
			return {
				type: 'info',
				message:
					'Usage: /model <provider> <model>\n\nUse /models to see all available options.',
			};
		}
		if (args.length < 2) {
			const provider = args[0];
			const providerInfo = PROVIDERS[provider as ProviderKey];
			if (!providerInfo) {
				return {
					type: 'error',
					message: `Unknown provider: ${provider}. Use /models to see available providers.`,
				};
			}
			args.push(providerInfo.defaultModel);
		}

		const provider = args[0];
		const model = args[1];

		if (!provider || !model) {
			return {
				type: 'error',
				message: 'Both provider and model are required',
			};
		}

		if (!Object.keys(PROVIDERS).includes(provider)) {
			return {
				type: 'error',
				message: `Unknown provider: ${provider}\nAvailable providers: ${Object.keys(
					PROVIDERS,
				).join(', ')}`,
			};
		}

		const result = this.setModel(provider, model);

		if (!result.success) {
			if (result.requiresApiKey) {
				return {
					type: 'prompt_api_key',
					message: `Please enter your ${provider.toUpperCase()} API key:`,
					data: {
						provider,
						model,
						envVar: result.envVar,
					},
				};
			}
			return {
				type: 'error',
				message: result.message,
			};
		}

		return {
			type: 'success',
			message: `✅ ${result.message}`,
			data: {llmConfig: this.getCurrentConfig()},
		};
	}

	/**
	 * Handles the /models command to list available models.
	 * @param args - Optional array with provider name to filter models
	 * @returns A CommandResult with the list of available models
	 */
	handleListModelsCommand(): CommandResult {
		const currentConfig = this.getCurrentConfig();

		let modelList = '📋 Available models by provider:\n\n';

		for (const [provider, info] of Object.entries(PROVIDERS)) {
			const current =
				provider === currentConfig?.provider ? ' ← current provider' : '';
			modelList += `🔸 ${provider}${current}:\n`;
			const model = info.defaultModel;
			const currentModel =
				current && model === currentConfig?.model ? ' ← current model' : '';
			modelList += `   • ${model} (default)${currentModel}\n`;
			modelList += '\n';
		}

		modelList += `\nNote: This list shows default models. Most providers support many more models that can be used with the /model command.\nDon't see your model/provider? Submit a PR to add it at https://github.com/mcp-use/mcp-use-cli/`;

		return {
			type: 'info',
			message: modelList.trim(),
		};
	}

	/**
	 * Handles the /config command to adjust temperature and max tokens.
	 * @param args - Array where args[0] is setting name and args[1] is value
	 * @returns A CommandResult with success/error status
	 */
	handleConfigCommand(args: string[]): CommandResult {
		if (args.length < 2) {
			return {
				type: 'error',
				message:
					'Usage: /config <setting> <value>\nAvailable settings: temp, tokens',
			};
		}

		const setting = args[0];
		const value = args[1];

		if (!value) {
			return {
				type: 'error',
				message: 'Value is required',
			};
		}

		if (!this.getCurrentConfig()) {
			return {
				type: 'error',
				message:
					'No model configured. Use /model to select a provider and model first.',
			};
		}

		switch (setting) {
			case 'temp':
			case 'temperature':
				const temp = parseFloat(value);
				if (isNaN(temp)) {
					return {
						type: 'error',
						message: 'Temperature must be a number',
					};
				}
				const tempResult = this.setTemperature(temp);
				if (!tempResult.success) {
					return {
						type: 'error',
						message: tempResult.message,
					};
				}
				return {
					type: 'success',
					message: `✅ ${tempResult.message}`,
					data: {llmConfig: this.getCurrentConfig()},
				};

			case 'tokens':
			case 'max-tokens':
				const tokens = parseInt(value);
				if (isNaN(tokens)) {
					return {
						type: 'error',
						message: 'Max tokens must be a number',
					};
				}
				const tokensResult = this.setMaxTokens(tokens);
				if (!tokensResult.success) {
					return {
						type: 'error',
						message: tokensResult.message,
					};
				}
				return {
					type: 'success',
					message: `✅ ${tokensResult.message}`,
					data: {llmConfig: this.getCurrentConfig()},
				};

			default:
				return {
					type: 'error',
					message: `Unknown setting: ${setting}\nAvailable settings: temp, tokens`,
				};
		}
	}

	/**
	 * Handles the /setkey command to manually set API keys.
	 * @param args - Array where args[0] is provider and args[1] is API key
	 * @returns A CommandResult with success/error status
	 */
	handleSetKeyCommand(args: string[]): CommandResult {
		if (args.length < 2) {
			return {
				type: 'error',
				message:
					'Usage: /setkey <provider> <api_key>\n\nSupported providers: openai, anthropic, google, mistral\n\nExample:\n/setkey openai sk-1234567890abcdef...',
			};
		}

		const provider = args[0]?.toLowerCase();
		const apiKey = args[1];

		if (!provider || !apiKey) {
			return {
				type: 'error',
				message: 'Both provider and API key are required',
			};
		}

		const validProviders = Object.keys(PROVIDERS);
		if (!validProviders.includes(provider)) {
			return {
				type: 'error',
				message: `Invalid provider: ${provider}\nSupported providers: ${validProviders.join(
					', ',
				)}`,
			};
		}

		const shouldAutoSelect = !this.getCurrentConfig();

		const result = this.setApiKey(provider, apiKey, shouldAutoSelect);

		if (!result.success) {
			return {
				type: 'error',
				message: result.message,
			};
		}

		const maskedKey = this.maskApiKey(apiKey);
		let message = `✅ ${provider} API key set (${maskedKey})`;

		if (result.autoSelected) {
			message += `\nAuto-selected ${result.autoSelected.provider}/${result.autoSelected.model}`;
		}

		return {
			type: 'success',
			message,
			data: result.autoSelected ? {llmConfig: result.autoSelected} : undefined,
		};
	}

	/**
	 * Handles the /clearkeys command to clear all stored API keys.
	 * @returns A CommandResult indicating success
	 */
	handleClearKeysCommand(): CommandResult {
		this.clearApiKeys();

		return {
			type: 'success',
			message:
				'✅ All API keys cleared from storage.\n\nUse /setkey or /model to set up a new provider.',
			data: {llmConfig: null},
		};
	}

	/**
	 * Handles API key input when prompted during model selection.
	 * @param apiKey - The API key entered by the user
	 * @param provider - The provider for the API key
	 * @param model - The model to select after setting the key
	 * @returns A CommandResult with success/error status
	 */
	handleApiKeyInput(
		apiKey: string,
		provider: string,
		model: string,
	): CommandResult {
		const keyResult = this.setApiKey(provider, apiKey, false);
		if (!keyResult.success) {
			return {
				type: 'error',
				message: keyResult.message,
			};
		}

		const modelResult = this.setModel(provider, model);
		if (!modelResult.success) {
			return {
				type: 'error',
				message: modelResult.message,
			};
		}

		const maskedKey = this.maskApiKey(apiKey);
		return {
			type: 'success',
			message: `✅ ${provider} API key set (${maskedKey})\n Switched to ${provider}/${model}`,
			data: {llmConfig: this.getCurrentConfig()},
		};
	}
}
