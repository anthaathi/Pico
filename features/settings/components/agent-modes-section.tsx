import { useCallback, useState } from 'react';
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
  Pencil,
  X,
  Check,
  Layers,
  Star,
} from 'lucide-react-native';

import { Fonts } from '@/constants/theme';
import { useAgentModes, type AgentMode } from '@pi-ui/client';

function useColors(isDark: boolean) {
  return {
    textPrimary: isDark ? '#fefdfd' : '#1a1a1a',
    textMuted: isDark ? '#cdc8c5' : '#888',
    inputBg: isDark ? '#2a2a28' : '#FFFFFF',
    inputBorder: isDark ? '#3a3a38' : '#E0E0DE',
    borderColor: isDark ? '#2a2a2a' : 'rgba(0,0,0,0.08)',
    cardBg: isDark ? '#1a1a1a' : '#FFFFFF',
    formBg: isDark ? '#1e1e1c' : '#F7F7F5',
    tagBg: isDark ? '#2a2a28' : '#EAEAE8',
    tagBorder: isDark ? '#3a3a38' : '#D5D5D3',
    dangerColor: '#D71921',
    isDark,
  };
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  mono,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
  mono?: boolean;
}) {
  return (
    <View style={fieldStyles.container}>
      <Text style={[fieldStyles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[
          fieldStyles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
          },
          mono && { fontFamily: Fonts.mono, fontSize: 12 },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.isDark ? '#555' : '#bbb'}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function TagInput({
  label,
  values,
  onChange,
  placeholder,
  colors,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [inputValue, setInputValue] = useState('');

  const addValue = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue('');
  }, [inputValue, values, onChange]);

  const removeValue = useCallback(
    (idx: number) => {
      onChange(values.filter((_, i) => i !== idx));
    },
    [values, onChange],
  );

  return (
    <View style={fieldStyles.container}>
      <Text style={[fieldStyles.label, { color: colors.textMuted }]}>{label}</Text>
      {values.length > 0 && (
        <View style={tagStyles.tags}>
          {values.map((v, i) => (
            <View
              key={`${v}-${i}`}
              style={[tagStyles.tag, { backgroundColor: colors.tagBg, borderColor: colors.tagBorder }]}
            >
              <Text
                style={[tagStyles.tagText, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {v}
              </Text>
              <Pressable onPress={() => removeValue(i)} hitSlop={6}>
                <X size={11} color={colors.textMuted} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={tagStyles.inputRow}>
        <TextInput
          style={[
            fieldStyles.input,
            {
              flex: 1,
              color: colors.textPrimary,
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              fontFamily: Fonts.mono,
              fontSize: 12,
            },
          ]}
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={addValue}
          placeholder={placeholder}
          placeholderTextColor={colors.isDark ? '#555' : '#bbb'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        <Pressable
          onPress={addValue}
          disabled={!inputValue.trim()}
          style={({ pressed }) => [
            tagStyles.addBtn,
            {
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              opacity: !inputValue.trim() ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Plus size={14} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

interface ModeDraft {
  name: string;
  description: string;
  model: string;
  thinkingLevel: string;
  extensions: string[];
  skills: string[];
  extraArgs: string;
  isDefault: boolean;
}

function emptyDraft(): ModeDraft {
  return {
    name: '',
    description: '',
    model: '',
    thinkingLevel: '',
    extensions: [],
    skills: [],
    extraArgs: '',
    isDefault: false,
  };
}

function modeToDraft(mode: AgentMode): ModeDraft {
  return {
    name: mode.name,
    description: mode.description ?? '',
    model: mode.model ?? '',
    thinkingLevel: mode.thinking_level ?? '',
    extensions: [...mode.extensions],
    skills: [...mode.skills],
    extraArgs: mode.extra_args.join(' '),
    isDefault: mode.is_default,
  };
}

function splitSpaceSeparated(val: string): string[] {
  return val.split(/\s+/).filter(Boolean);
}

function ModeForm({
  draft,
  setDraft,
  colors,
  onSave,
  onCancel,
  saveLabel,
}: {
  draft: ModeDraft;
  setDraft: (d: ModeDraft) => void;
  colors: ReturnType<typeof useColors>;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <View style={[formStyles.container, { backgroundColor: colors.formBg }]}>
      <Field
        label="Name"
        value={draft.name}
        onChangeText={(v) => setDraft({ ...draft, name: v })}
        placeholder="e.g. Deep Thinking"
        colors={colors}
      />
      <Field
        label="Description"
        value={draft.description}
        onChangeText={(v) => setDraft({ ...draft, description: v })}
        placeholder="Optional description"
        colors={colors}
      />
      <Field
        label="Model"
        value={draft.model}
        onChangeText={(v) => setDraft({ ...draft, model: v })}
        placeholder="e.g. anthropic/claude-sonnet-4"
        colors={colors}
        mono
      />
      <Field
        label="Thinking Level"
        value={draft.thinkingLevel}
        onChangeText={(v) => setDraft({ ...draft, thinkingLevel: v })}
        placeholder="off, minimal, low, medium, high, xhigh"
        colors={colors}
      />
      <TagInput
        label="Extensions"
        values={draft.extensions}
        onChange={(v) => setDraft({ ...draft, extensions: v })}
        placeholder="Add extension path…"
        colors={colors}
      />
      <TagInput
        label="Skills"
        values={draft.skills}
        onChange={(v) => setDraft({ ...draft, skills: v })}
        placeholder="Add skill path…"
        colors={colors}
      />
      <Field
        label="Extra CLI Args"
        value={draft.extraArgs}
        onChangeText={(v) => setDraft({ ...draft, extraArgs: v })}
        placeholder="e.g. --no-tools --verbose"
        colors={colors}
        mono
      />
      <Pressable
        onPress={() => setDraft({ ...draft, isDefault: !draft.isDefault })}
        style={formStyles.defaultRow}
      >
        <Star
          size={14}
          color={draft.isDefault ? '#E8A300' : colors.textMuted}
          fill={draft.isDefault ? '#E8A300' : 'none'}
          strokeWidth={1.8}
        />
        <Text style={[formStyles.defaultLabel, { color: colors.textPrimary }]}>
          Default mode
        </Text>
      </Pressable>
      <View style={formStyles.actions}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            formStyles.btn,
            { borderColor: colors.borderColor },
            pressed && { opacity: 0.7 },
          ]}
        >
          <X size={13} color={colors.textMuted} strokeWidth={2} />
          <Text style={[formStyles.btnText, { color: colors.textMuted }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={!draft.name.trim()}
          style={({ pressed }) => [
            formStyles.btn,
            {
              backgroundColor: colors.isDark ? '#fefdfd' : '#1a1a1a',
              borderColor: colors.isDark ? '#fefdfd' : '#1a1a1a',
            },
            pressed && { opacity: 0.7 },
            !draft.name.trim() && { opacity: 0.4 },
          ]}
        >
          <Check size={13} color={colors.isDark ? '#1a1a1a' : '#fff'} strokeWidth={2} />
          <Text style={[formStyles.btnText, { color: colors.isDark ? '#1a1a1a' : '#fff' }]}>
            {saveLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ModeRow({
  mode,
  colors,
  onEdit,
  onDelete,
  isLast,
}: {
  mode: AgentMode;
  colors: ReturnType<typeof useColors>;
  onEdit: () => void;
  onDelete: () => void;
  isLast: boolean;
}) {
  const parts: string[] = [];
  if (mode.model) parts.push(mode.model);
  if (mode.thinking_level) parts.push(`thinking: ${mode.thinking_level}`);
  if (mode.extensions.length) parts.push(`${mode.extensions.length} ext`);
  if (mode.skills.length) parts.push(`${mode.skills.length} skill`);
  if (mode.extra_args.length) parts.push(mode.extra_args.join(' '));

  return (
    <View
      style={[
        rowStyles.row,
        !isLast && { borderBottomWidth: 0.633, borderBottomColor: colors.borderColor },
      ]}
    >
      <View style={rowStyles.info}>
        <View style={rowStyles.nameRow}>
          <Text style={[rowStyles.name, { color: colors.textPrimary }]}>{mode.name}</Text>
          {mode.is_default && (
            <Star size={12} color="#E8A300" fill="#E8A300" strokeWidth={1.8} />
          )}
        </View>
        {parts.length > 0 && (
          <Text style={[rowStyles.detail, { color: colors.textMuted }]} numberOfLines={1}>
            {parts.join(' · ')}
          </Text>
        )}
        {mode.description ? (
          <Text style={[rowStyles.desc, { color: colors.textMuted }]} numberOfLines={1}>
            {mode.description}
          </Text>
        ) : null}
      </View>
      <View style={rowStyles.actions}>
        <Pressable onPress={onEdit} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Pencil size={14} color={colors.textMuted} strokeWidth={1.8} />
        </Pressable>
        <Pressable onPress={onDelete} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Trash2 size={14} color={colors.dangerColor} strokeWidth={1.8} />
        </Pressable>
      </View>
    </View>
  );
}

export function AgentModesSection({ isDark }: { isDark: boolean }) {
  const colors = useColors(isDark);
  const { modes, loaded, create, update, remove } = useAgentModes();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModeDraft>(emptyDraft());

  const safeList = Array.isArray(modes) ? modes : [];

  const handleCreate = useCallback(async () => {
    try {
      await create({
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        model: draft.model.trim() || undefined,
        thinkingLevel: draft.thinkingLevel.trim() || undefined,
        extensions: draft.extensions,
        skills: draft.skills,
        extraArgs: splitSpaceSeparated(draft.extraArgs),
        isDefault: draft.isDefault,
      });
      setAdding(false);
      setDraft(emptyDraft());
    } catch {}
  }, [create, draft]);

  const handleUpdate = useCallback(async () => {
    if (!editingId) return;
    try {
      await update(editingId, {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        model: draft.model.trim() || undefined,
        thinkingLevel: draft.thinkingLevel.trim() || undefined,
        extensions: draft.extensions,
        skills: draft.skills,
        extraArgs: splitSpaceSeparated(draft.extraArgs),
        isDefault: draft.isDefault,
      });
      setEditingId(null);
      setDraft(emptyDraft());
    } catch {}
  }, [update, editingId, draft]);

  if (!loaded) return null;

  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Layers size={15} color={colors.textPrimary} strokeWidth={1.8} />
        <Text style={[sectionStyles.title, { color: colors.textPrimary }]}>Agent Modes</Text>
        {!adding && !editingId && (
          <Pressable
            onPress={() => {
              setAdding(true);
              setDraft(emptyDraft());
            }}
            style={({ pressed }) => [sectionStyles.addBtn, pressed && { opacity: 0.7 }]}
          >
            <Plus size={14} color={colors.textPrimary} strokeWidth={2} />
          </Pressable>
        )}
      </View>

      <View style={[sectionStyles.card, { backgroundColor: colors.cardBg, borderColor: colors.borderColor }]}>
        {safeList.length === 0 && !adding && (
          <View style={sectionStyles.empty}>
            <Text style={[sectionStyles.emptyText, { color: colors.textMuted }]}>
              No modes configured. Sessions will start directly.
            </Text>
          </View>
        )}

        {safeList.map((mode, i) =>
          editingId === mode.id ? (
            <ModeForm
              key={mode.id}
              draft={draft}
              setDraft={setDraft}
              colors={colors}
              onSave={handleUpdate}
              onCancel={() => {
                setEditingId(null);
                setDraft(emptyDraft());
              }}
              saveLabel="Update"
            />
          ) : (
            <ModeRow
              key={mode.id}
              mode={mode}
              colors={colors}
              onEdit={() => {
                setEditingId(mode.id);
                setDraft(modeToDraft(mode));
                setAdding(false);
              }}
              onDelete={() => remove(mode.id)}
              isLast={i === safeList.length - 1 && !adding}
            />
          ),
        )}

        {adding && (
          <ModeForm
            draft={draft}
            setDraft={setDraft}
            colors={colors}
            onSave={handleCreate}
            onCancel={() => {
              setAdding(false);
              setDraft(emptyDraft());
            }}
            saveLabel="Create"
          />
        )}
      </View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  title: { fontSize: 14, fontFamily: Fonts.sansSemiBold, flex: 1 },
  addBtn: { padding: 4 },
  card: { borderRadius: 12, borderWidth: 0.633, overflow: 'hidden' },
  empty: { padding: 16 },
  emptyText: { fontSize: 13, fontFamily: Fonts.sans, textAlign: 'center' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  info: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 14, fontFamily: Fonts.sansMedium },
  detail: { fontSize: 12, fontFamily: Fonts.mono },
  desc: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 12 },
});

const formStyles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  defaultLabel: { fontSize: 13, fontFamily: Fonts.sans },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 0.633,
  },
  btnText: { fontSize: 12, fontFamily: Fonts.sansMedium },
});

const fieldStyles = StyleSheet.create({
  container: { gap: 4 },
  label: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 0.633,
  },
});

const tagStyles = StyleSheet.create({
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 0.633,
  },
  tagText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    maxWidth: 220,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 6,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: 0.633,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
