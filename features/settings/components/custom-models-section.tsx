import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Pencil,
  X,
  Check,
  Server,
  Cpu,
} from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import {
  useCustomModelsStore,
  type CustomProvider,
  type CustomModelEntry,
} from '../store/custom-models';

const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Chat' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic' },
  { value: 'google-generativeai', label: 'Google AI' },
];

// ─── Shared theme helper ──────────────────────────────────────

function useColors(isDark: boolean) {
  return {
    textPrimary: isDark ? '#fefdfd' : '#1a1a1a',
    textMuted: isDark ? '#cdc8c5' : '#888',
    inputBg: isDark ? '#242422' : '#F5F5F3',
    borderColor: isDark ? '#2a2a2a' : 'rgba(0,0,0,0.08)',
    cardBg: isDark ? '#1a1a1a' : '#FFFFFF',
    headerBg: isDark ? '#1e1e1c' : '#FAFAF8',
    accentBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    chipActiveBg: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    chipActiveBorder: isDark ? '#555' : '#ccc',
    chipBorder: isDark ? '#333' : '#e0e0e0',
    dangerColor: '#D71921',
    successColor: '#34C759',
    isDark,
  };
}

// ─── Field ────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  mono,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View style={fieldStyles.container}>
      <Text style={[fieldStyles.label, { color: colors.textMuted }]}>
        {label}
      </Text>
      <TextInput
        style={[
          fieldStyles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.inputBg,
            borderColor: colors.borderColor,
          },
          mono && { fontFamily: Fonts.mono, fontSize: 12 },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.isDark ? '#555' : '#bbb'}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
    </View>
  );
}

// ─── API Type Selector ────────────────────────────────────────

function ApiTypeSelector({
  value,
  onChange,
  colors,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={fieldStyles.container}>
      <Text style={[fieldStyles.label, { color: colors.textMuted }]}>
        API Type
      </Text>
      <View style={apiStyles.row}>
        {API_TYPES.map((item) => {
          const isActive = value === item.value;
          return (
            <Pressable
              key={item.value}
              onPress={() => onChange(item.value)}
              style={[
                apiStyles.chip,
                {
                  backgroundColor: isActive ? colors.chipActiveBg : 'transparent',
                  borderColor: isActive
                    ? colors.chipActiveBorder
                    : colors.chipBorder,
                },
              ]}
            >
              <Text
                style={[
                  apiStyles.chipText,
                  { color: isActive ? colors.textPrimary : colors.textMuted },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Model Entry ──────────────────────────────────────────────

function ModelEntryRow({
  model,
  onRemove,
  onUpdate,
  colors,
  isLast,
}: {
  model: CustomModelEntry;
  onRemove: () => void;
  onUpdate: (m: CustomModelEntry) => void;
  colors: ReturnType<typeof useColors>;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  useEffect(() => {
    setDraft(model);
  }, [model]);

  if (editing) {
    return (
      <View style={[modelStyles.editWrap, { backgroundColor: colors.accentBg }]}>
        <View style={modelStyles.editGrid}>
          <View style={{ flex: 1 }}>
            <Field
              label="Model ID"
              value={draft.id}
              onChangeText={(v) => setDraft({ ...draft, id: v })}
              placeholder="llama3.1:8b"
              colors={colors}
              mono
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Display Name"
              value={draft.name ?? ''}
              onChangeText={(v) =>
                setDraft({ ...draft, name: v || undefined })
              }
              placeholder="Optional"
              colors={colors}
            />
          </View>
        </View>
        <View style={modelStyles.editGrid}>
          <View style={{ flex: 1 }}>
            <Field
              label="Context Window"
              value={draft.contextWindow?.toString() ?? ''}
              onChangeText={(v) =>
                setDraft({
                  ...draft,
                  contextWindow: v ? parseInt(v, 10) || undefined : undefined,
                })
              }
              placeholder="128000"
              colors={colors}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Max Tokens"
              value={draft.maxTokens?.toString() ?? ''}
              onChangeText={(v) =>
                setDraft({
                  ...draft,
                  maxTokens: v ? parseInt(v, 10) || undefined : undefined,
                })
              }
              placeholder="32000"
              colors={colors}
            />
          </View>
        </View>
        <View style={modelStyles.editActions}>
          <Pressable
            onPress={() => setEditing(false)}
            style={({ pressed }) => [
              modelStyles.smallBtn,
              { borderColor: colors.borderColor },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[modelStyles.smallBtnText, { color: colors.textMuted }]}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (draft.id.trim()) {
                onUpdate({ ...draft, id: draft.id.trim() });
                setEditing(false);
              }
            }}
            style={({ pressed }) => [
              modelStyles.smallBtn,
              {
                backgroundColor: colors.isDark ? '#333' : '#1a1a1a',
                borderColor: colors.isDark ? '#333' : '#1a1a1a',
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                modelStyles.smallBtnText,
                { color: colors.isDark ? '#fefdfd' : '#fff' },
              ]}
            >
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        modelStyles.row,
        !isLast && {
          borderBottomWidth: 0.633,
          borderBottomColor: colors.borderColor,
        },
      ]}
    >
      <Cpu size={13} color={colors.textMuted} strokeWidth={1.8} />
      <View style={modelStyles.info}>
        <Text style={[modelStyles.modelId, { color: colors.textPrimary }]}>
          {model.id}
        </Text>
        {model.name ? (
          <Text style={[modelStyles.modelMeta, { color: colors.textMuted }]}>
            {model.name}
            {model.contextWindow
              ? ` · ${(model.contextWindow / 1000).toFixed(0)}k ctx`
              : ''}
          </Text>
        ) : model.contextWindow ? (
          <Text style={[modelStyles.modelMeta, { color: colors.textMuted }]}>
            {(model.contextWindow / 1000).toFixed(0)}k context
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => setEditing(true)}
        style={({ pressed }) => [modelStyles.iconBtn, pressed && { opacity: 0.6 }]}
      >
        <Pencil size={13} color={colors.textMuted} strokeWidth={1.8} />
      </Pressable>
      <Pressable
        onPress={onRemove}
        style={({ pressed }) => [modelStyles.iconBtn, pressed && { opacity: 0.6 }]}
      >
        <Trash2 size={13} color={colors.dangerColor} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}

// ─── Provider Card ────────────────────────────────────────────

function ProviderCard({
  name,
  provider,
  colors,
  onUpdate,
  onRemove,
}: {
  name: string;
  provider: CustomProvider;
  colors: ReturnType<typeof useColors>;
  onUpdate: (p: CustomProvider) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [newModelId, setNewModelId] = useState('');

  const models = provider.models ?? [];

  const handleAddModel = useCallback(() => {
    const trimmed = newModelId.trim();
    if (!trimmed) return;
    onUpdate({
      ...provider,
      models: [...models, { id: trimmed }],
    });
    setNewModelId('');
    setAddingModel(false);
  }, [newModelId, provider, models, onUpdate]);

  const ChevronIcon = expanded ? ChevronUp : ChevronDown;
  const apiLabel =
    API_TYPES.find((t) => t.value === provider.api)?.label ?? provider.api ?? 'Not set';

  return (
    <View style={[cardStyles.card, { backgroundColor: colors.cardBg, borderColor: colors.borderColor }]}>
      {/* Header */}
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={({ hovered }: any) => [
          cardStyles.header,
          hovered && { backgroundColor: colors.accentBg },
        ]}
      >
        <View style={cardStyles.headerLeft}>
          <View style={[cardStyles.providerIcon, { backgroundColor: colors.accentBg }]}>
            <Server size={14} color={colors.textMuted} strokeWidth={1.8} />
          </View>
          <View style={cardStyles.headerText}>
            <Text style={[cardStyles.providerName, { color: colors.textPrimary }]}>
              {name}
            </Text>
            <Text style={[cardStyles.providerMeta, { color: colors.textMuted }]}>
              {apiLabel} · {models.length} model{models.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
        <View style={cardStyles.headerRight}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onRemove();
            }}
            style={({ pressed }) => [
              cardStyles.headerBtn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Trash2 size={14} color={colors.dangerColor} strokeWidth={1.8} />
          </Pressable>
          <ChevronIcon size={15} color={colors.textMuted} strokeWidth={1.8} />
        </View>
      </Pressable>

      {/* Expanded body */}
      {expanded && (
        <View style={[cardStyles.body, { borderTopWidth: 0.633, borderTopColor: colors.borderColor }]}>
          {/* Connection fields */}
          <Field
            label="Base URL"
            value={provider.baseUrl ?? ''}
            onChangeText={(v) => onUpdate({ ...provider, baseUrl: v || undefined })}
            placeholder="http://localhost:11434/v1"
            colors={colors}
            mono
          />
          <ApiTypeSelector
            value={provider.api ?? 'openai-completions'}
            onChange={(v) => onUpdate({ ...provider, api: v })}
            colors={colors}
          />
          <Field
            label="API Key"
            value={provider.apiKey ?? ''}
            onChangeText={(v) => onUpdate({ ...provider, apiKey: v || undefined })}
            placeholder="Optional — env var, !command, or literal key"
            colors={colors}
          />

          {/* Models list */}
          <View style={cardStyles.modelsSection}>
            <View style={cardStyles.modelsSectionHeader}>
              <Text style={[cardStyles.modelsSectionTitle, { color: colors.textPrimary }]}>
                Models
              </Text>
              <Pressable
                onPress={() => setAddingModel(true)}
                style={({ pressed }) => [
                  cardStyles.addModelBtn,
                  { borderColor: colors.borderColor },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Plus size={12} color={colors.textMuted} strokeWidth={2} />
                <Text style={[cardStyles.addModelBtnText, { color: colors.textMuted }]}>
                  Add Model
                </Text>
              </Pressable>
            </View>

            {models.length > 0 && (
              <View style={[cardStyles.modelsList, { borderColor: colors.borderColor }]}>
                {models.map((model, idx) => (
                  <ModelEntryRow
                    key={`${model.id}-${idx}`}
                    model={model}
                    onRemove={() => {
                      onUpdate({
                        ...provider,
                        models: models.filter((_, i) => i !== idx),
                      });
                    }}
                    onUpdate={(m) => {
                      const next = [...models];
                      next[idx] = m;
                      onUpdate({ ...provider, models: next });
                    }}
                    colors={colors}
                    isLast={idx === models.length - 1}
                  />
                ))}
              </View>
            )}

            {addingModel && (
              <View style={[cardStyles.addModelRow, { borderColor: colors.borderColor }]}>
                <TextInput
                  style={[
                    cardStyles.addModelInput,
                    {
                      color: colors.textPrimary,
                      backgroundColor: colors.inputBg,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  value={newModelId}
                  onChangeText={setNewModelId}
                  placeholder="Model ID (e.g. llama3.1:8b)"
                  placeholderTextColor={colors.isDark ? '#555' : '#bbb'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  onSubmitEditing={handleAddModel}
                />
                <Pressable
                  onPress={() => {
                    setAddingModel(false);
                    setNewModelId('');
                  }}
                  style={({ pressed }) => [
                    cardStyles.addModelIconBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <X size={15} color={colors.textMuted} strokeWidth={1.8} />
                </Pressable>
                <Pressable
                  onPress={handleAddModel}
                  style={({ pressed }) => [
                    cardStyles.addModelIconBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Check size={15} color={colors.successColor} strokeWidth={2} />
                </Pressable>
              </View>
            )}

            {models.length === 0 && !addingModel && (
              <Text style={[cardStyles.emptyModels, { color: colors.textMuted }]}>
                No models added yet.
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Add Provider Form ────────────────────────────────────────

function AddProviderForm({
  colors,
  onAdd,
  onCancel,
}: {
  colors: ReturnType<typeof useColors>;
  onAdd: (name: string, baseUrl: string, api: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState('openai-completions');

  return (
    <View style={[cardStyles.card, { backgroundColor: colors.cardBg, borderColor: colors.borderColor }]}>
      <View style={cardStyles.body}>
        <Text style={[addStyles.formTitle, { color: colors.textPrimary }]}>
          New Provider
        </Text>
        <Field
          label="Provider Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. ollama, lm-studio, my-vllm"
          colors={colors}
          autoFocus
        />
        <Field
          label="Base URL"
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="http://localhost:11434/v1"
          colors={colors}
          mono
        />
        <ApiTypeSelector value={api} onChange={setApi} colors={colors} />
        <View style={addStyles.actions}>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [
              addStyles.btn,
              { borderColor: colors.borderColor },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[addStyles.btnText, { color: colors.textMuted }]}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (name.trim()) {
                onAdd(name.trim(), baseUrl.trim(), api);
              }
            }}
            style={({ pressed }) => [
              addStyles.btn,
              {
                backgroundColor: colors.isDark ? '#fefdfd' : '#1a1a1a',
                borderColor: colors.isDark ? '#fefdfd' : '#1a1a1a',
              },
              !name.trim() && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                addStyles.btnText,
                { color: colors.isDark ? '#1a1a1a' : '#fff' },
              ]}
            >
              Add Provider
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Main Section ─────────────────────────────────────────────

export function CustomModelsSection({ isDark }: { isDark: boolean }) {
  const colors = useColors(isDark);
  const { providers, loaded, saving, load, addProvider, removeProvider, updateProvider } =
    useCustomModelsStore();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const handleAddProvider = useCallback(
    (name: string, baseUrl: string, api: string) => {
      addProvider(name, {
        baseUrl: baseUrl || undefined,
        api,
        models: [],
      });
      setAdding(false);
    },
    [addProvider]
  );

  const providerEntries = Object.entries(providers);

  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Server size={15} color={colors.textPrimary} strokeWidth={1.8} />
        <View style={sectionStyles.headerTextCol}>
          <Text style={[sectionStyles.title, { color: colors.textPrimary }]}>
            Custom Models
          </Text>
          <Text style={[sectionStyles.subtitle, { color: colors.textMuted }]}>
            Ollama, LM Studio, vLLM, or any OpenAI-compatible provider
          </Text>
        </View>
      </View>

      {!loaded ? (
        <View
          style={[
            cardStyles.card,
            { backgroundColor: colors.cardBg, borderColor: colors.borderColor },
          ]}
        >
          <View style={sectionStyles.loadingRow}>
            <Text style={[sectionStyles.loadingText, { color: colors.textMuted }]}>
              Loading configuration...
            </Text>
          </View>
        </View>
      ) : (
        <View style={sectionStyles.list}>
          {providerEntries.map(([name, provider]) => (
            <ProviderCard
              key={name}
              name={name}
              provider={provider}
              colors={colors}
              onUpdate={(p) => updateProvider(name, p)}
              onRemove={() => removeProvider(name)}
            />
          ))}

          {adding ? (
            <AddProviderForm
              colors={colors}
              onAdd={handleAddProvider}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              style={({ pressed, hovered }: any) => [
                sectionStyles.addButton,
                { borderColor: colors.borderColor },
                hovered && { backgroundColor: colors.accentBg },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Plus size={15} color={colors.textMuted} strokeWidth={1.8} />
              <Text
                style={[sectionStyles.addButtonText, { color: colors.textMuted }]}
              >
                Add Provider
              </Text>
            </Pressable>
          )}

          {saving && (
            <Text style={[sectionStyles.savingText, { color: colors.textMuted }]}>
              Saving to ~/.pi/agent/models.json...
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const sectionStyles = StyleSheet.create({
  container: {
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 4,
  },
  headerTextCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  list: {
    gap: 10,
  },
  loadingRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 0.633,
    borderStyle: 'dashed',
  },
  addButtonText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  savingText: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: -4,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 0.633,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  providerIcon: {
    width: 30,
    height: 30,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 1,
  },
  providerName: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  providerMeta: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    padding: 4,
  },
  body: {
    padding: 14,
    gap: 14,
  },
  modelsSection: {
    gap: 8,
    marginTop: 2,
  },
  modelsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modelsSectionTitle: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  addModelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 0.633,
  },
  addModelBtnText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  modelsList: {
    borderRadius: 8,
    borderWidth: 0.633,
    overflow: 'hidden',
  },
  addModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addModelInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.mono,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 0.633,
  },
  addModelIconBtn: {
    padding: 4,
  },
  emptyModels: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    paddingVertical: 2,
  },
});

const modelStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  info: {
    flex: 1,
    gap: 1,
  },
  modelId: {
    fontSize: 13,
    fontFamily: Fonts.mono,
  },
  modelMeta: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  iconBtn: {
    padding: 4,
  },
  editWrap: {
    margin: 8,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  editGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 0.633,
  },
  smallBtnText: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
});

const fieldStyles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  input: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 0.633,
  },
});

const apiStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 0.633,
  },
  chipText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
});

const addStyles = StyleSheet.create({
  formTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    marginBottom: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 0.633,
  },
  btnText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
});
