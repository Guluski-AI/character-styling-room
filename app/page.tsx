"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzeWithCodex,
  checkLocalHealth,
  generateWithCodex,
  importDataUrlAsset,
  importLocalAsset,
  LocalHealth,
  LocalWardrobeImage,
  scanLocalWardrobe,
} from "./lib/local-service";

type Outfit = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  tags: string[];
  top: string;
  bottom: string;
  shoes: string;
  accessory: string;
  hair: string;
  tone: string;
  fit: string;
  swatches: string[];
  imagePrompt?: string;
  consistency?: string;
  previewUrl?: string;
  previewPath?: string;
};

type FormState = {
  role: string;
  theme: string;
  scene: string;
  season: string;
  avoid: string;
};

type FavoriteLook = {
  id: string;
  name: string;
  tags: string[];
  source: "upload" | "generated" | "folder";
  imageData?: string;
  swatches?: string[];
  imagePath?: string;
  previewUrl?: string;
};

type SavedPlan = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  form: FormState;
  styles: string[];
  customTags: string[];
  outfits: Outfit[];
  selectedId: string;
  runId: string;
  characterImagePath: string;
  referencePaths: string[];
  referenceIds: string[];
  referenceNames: string[];
};

const STYLE_OPTIONS = ["亲和", "轻科技", "松弛", "轻商务", "有趣", "个性"];
const MAX_CUSTOM_TAGS = 8;
const FAVORITES_STORAGE_KEY = "character-styling-favorites-v1";
const WARDROBE_FOLDER_STORAGE_KEY = "character-styling-folder-v1";
const SAVED_PLANS_STORAGE_KEY = "character-styling-plans-v1";
const MAX_SAVED_PLANS = 50;
const PLANS_PER_PAGE = 3;

const OUTFITS: Outfit[] = [
  {
    id: "friendly",
    eyebrow: "方向 01",
    title: "亲和教程型",
    summary: "用柔和浅色与放松轮廓，降低知识内容的距离感。",
    tags: ["自然", "可信", "轻松"],
    top: "奶油白短袖针织上衣，简洁圆领",
    bottom: "浅灰色直筒休闲长裤",
    shoes: "低饱和米白运动鞋",
    accessory: "极简银色耳钉、无明显品牌标识",
    hair: "保留原发型，整理得自然清爽",
    tone: "亲切、轻松、可信，没有过度职业感",
    fit: "教程讲解、录屏封面、知识分享",
    swatches: ["#eee9dc", "#bdc2bd", "#d7d1c5"],
  },
  {
    id: "tech",
    eyebrow: "方向 02",
    title: "轻科技专业型",
    summary: "以利落结构和低饱和冷色，建立清晰、现代的专业感。",
    tags: ["现代", "克制", "利落"],
    top: "雾蓝灰短袖功能衬衫，利落暗门襟",
    bottom: "深石墨灰高腰直筒长裤",
    shoes: "简洁银灰色轻量鞋履",
    accessory: "窄表盘手表、单枚几何耳饰",
    hair: "保留原发型，轮廓稍微收紧",
    tone: "专业、冷静、现代，但不过度商务",
    fit: "AI 工具解析、技术说明、观点表达",
    swatches: ["#cbd5d8", "#545b5e", "#9aabae"],
  },
  {
    id: "creator",
    eyebrow: "方向 03",
    title: "创作者松弛型",
    summary: "自然材质与宽松层次，让角色更像有生活感的持续创作者。",
    tags: ["松弛", "日常", "有质感"],
    top: "鼠尾草绿宽松落肩上衣，轻薄棉麻质感",
    bottom: "暖卡其色宽松休闲裤",
    shoes: "干净的浅棕色便鞋",
    accessory: "小体量编织手环或细框眼镜",
    hair: "保留原发型，呈现自然随性的发丝",
    tone: "有生活感、松弛、亲近，适合连续更新",
    fit: "日常 Vlog、幕后分享、创意玩法",
    swatches: ["#aeb8a2", "#cab896", "#ece4d6"],
  },
];

const INITIAL_FORM: FormState = {
  role: "年轻档案管理员",
  theme: "AI 工具教程",
  scene: "干净的数字档案室",
  season: "夏季",
  avoid: "不要太商务，不要夸张品牌标识",
};

function UploadPlaceholder() {
  return (
    <div className="avatar-placeholder" aria-hidden="true">
      <div className="avatar-head" />
      <div className="avatar-body" />
      <span>角色图</span>
    </div>
  );
}

function FavoritePreview({ favorite }: { favorite: FavoriteLook }) {
  const imageSource = favorite.previewUrl ?? favorite.imageData;
  if (imageSource) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageSource} alt={`${favorite.name}穿搭参考`} loading="lazy" />
    );
  }

  const swatches = favorite.swatches ?? ["#e2ded4", "#929a91", "#c6b79d"];

  return (
    <div className="favorite-generated-preview" aria-label={`${favorite.name}造型示意`}>
      <div className="favorite-preview-swatches">
        {swatches.map((color) => (
          <span key={color} style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className="favorite-mini-figure">
        <span className="favorite-mini-head" />
        <span className="favorite-mini-top" style={{ backgroundColor: swatches[0] }} />
        <span className="favorite-mini-bottom" style={{ backgroundColor: swatches[1] }} />
      </div>
    </div>
  );
}

export default function Home() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [styles, setStyles] = useState<string[]>(["亲和", "轻科技"]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");
  const [outfits, setOutfits] = useState<Outfit[]>(OUTFITS);
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [characterImagePath, setCharacterImagePath] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [generated, setGenerated] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [savedPlansReady, setSavedPlansReady] = useState(false);
  const [plansPage, setPlansPage] = useState(1);
  const [activePlanId, setActivePlanId] = useState("");
  const [savedReferenceNames, setSavedReferenceNames] = useState<string[]>([]);
  const [planMessage, setPlanMessage] = useState("");
  const [runId, setRunId] = useState("");
  const [runCharacterPath, setRunCharacterPath] = useState("");
  const [runReferencePaths, setRunReferencePaths] = useState<string[]>([]);
  const [copied, setCopied] = useState<string>("");
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState<FavoriteLook[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);
  const [localConnected, setLocalConnected] = useState(false);
  const [localStatus, setLocalStatus] = useState("正在检查本地服务…");
  const [cliStatus, setCliStatus] = useState<
    "checking" | "connected" | "not_found" | "not_authenticated" | "service_offline"
  >("checking");
  const [cliBinary, setCliBinary] = useState("");
  const [cliPreferenceMode, setCliPreferenceMode] = useState<"auto" | "manual">(
    "auto",
  );
  const [cliConfiguredPath, setCliConfiguredPath] = useState("");
  const [cliSettingsOpen, setCliSettingsOpen] = useState(false);
  const [checkingCli, setCheckingCli] = useState(false);
  const [cliMessage, setCliMessage] = useState("");
  const [wardrobeFolder, setWardrobeFolder] = useState("");
  const [folderImages, setFolderImages] = useState<LocalWardrobeImage[]>([]);
  const [scanningWardrobe, setScanningWardrobe] = useState(false);
  const [generatingOutfits, setGeneratingOutfits] = useState(false);
  const [generatingPreviewId, setGeneratingPreviewId] = useState("");
  const [savingPreviewId, setSavingPreviewId] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [useFavoriteReferences, setUseFavoriteReferences] = useState(false);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [wardrobeMessage, setWardrobeMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const wardrobeFileRef = useRef<HTMLInputElement>(null);

  const folderFavorites = useMemo<FavoriteLook[]>(
    () =>
      folderImages.map((image) => ({
        id: `folder-${image.id}`,
        name: image.name,
        tags: image.tags.length ? image.tags : ["本地文件夹"],
        source: "folder",
        imagePath: image.absolutePath,
        previewUrl: image.previewUrl,
      })),
    [folderImages],
  );
  const wardrobeItems = useMemo(
    () => [...folderFavorites, ...favorites],
    [favorites, folderFavorites],
  );
  const generationStyles = useMemo(
    () => [...styles, ...customTags],
    [customTags, styles],
  );
  const selectedOutfit = outfits.find((outfit) => outfit.id === selectedId);
  const activeReferences = useMemo(
    () =>
      useFavoriteReferences
        ? wardrobeItems.filter((favorite) => selectedReferenceIds.includes(favorite.id))
        : [],
    [selectedReferenceIds, useFavoriteReferences, wardrobeItems],
  );
  const totalPlanPages = Math.max(
    1,
    Math.ceil(savedPlans.length / PLANS_PER_PAGE),
  );
  const currentPlansPage = Math.min(plansPage, totalPlanPages);
  const visibleSavedPlans = useMemo(() => {
    const start = (currentPlansPage - 1) * PLANS_PER_PAGE;
    return savedPlans.slice(start, start + PLANS_PER_PAGE);
  }, [currentPlansPage, savedPlans]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (saved) setFavorites(JSON.parse(saved) as FavoriteLook[]);
    } catch {
      setWardrobeMessage("未能读取本机收藏，当前仍可继续体验。");
    } finally {
      setFavoritesReady(true);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SAVED_PLANS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedPlan[];
        if (Array.isArray(parsed)) setSavedPlans(parsed.slice(0, MAX_SAVED_PLANS));
      }
    } catch {
      setPlanMessage("未能读取本机方案记录，新的方案仍会继续保存。");
    } finally {
      setSavedPlansReady(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const isDesktop = Boolean(window.stylingDesktop);
    setDesktopMode(isDesktop);

    async function connectLocalService() {
      try {
        if (isDesktop && window.stylingDesktop?.getCodexCliPreference) {
          const preference = await window.stylingDesktop.getCodexCliPreference();
          if (!active) return;
          setCliPreferenceMode(preference.mode);
          setCliConfiguredPath(preference.path);
        }

        const health = await checkLocalHealth();
        if (!active) return;
        applyCodexHealth(health);

        const savedFolder = window.localStorage.getItem(
          WARDROBE_FOLDER_STORAGE_KEY,
        );
        if (!savedFolder || !health.model.authenticated) return;
        setWardrobeFolder(savedFolder);
        const result = await scanLocalWardrobe(savedFolder);
        if (!active) return;
        setFolderImages(result.images);
        setWardrobeMessage(
          `已从本地文件夹恢复 ${result.total} 张穿搭参考。`,
        );
      } catch {
        if (!active) return;
        setLocalConnected(false);
        setCliStatus("service_offline");
        setCliBinary("");
        setLocalStatus("演示模式 · 启动本地服务后可使用 Codex");
      }
    }

    void connectLocalService();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!favoritesReady) return;
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      setWardrobeMessage("收藏空间已满，请删除部分图片后再试。");
    }
  }, [favorites, favoritesReady]);

  useEffect(() => {
    if (!savedPlansReady) return;
    try {
      window.localStorage.setItem(
        SAVED_PLANS_STORAGE_KEY,
        JSON.stringify(savedPlans),
      );
    } catch {
      setPlanMessage("方案记录空间已满，请删除一些旧方案后再试。");
    }
  }, [savedPlans, savedPlansReady]);

  useEffect(() => {
    setPlansPage((current) => Math.min(current, totalPlanPages));
  }, [totalPlanPages]);

  const promptSet = useMemo(() => {
    if (!selectedOutfit) return null;

    const styleText = generationStyles.length
      ? generationStyles.join("、")
      : "自然、清晰";
    const fullLook = `${selectedOutfit.top}；${selectedOutfit.bottom}；${selectedOutfit.shoes}；配饰为${selectedOutfit.accessory}；${selectedOutfit.hair}`;
    const referenceNames = activeReferences.length
      ? activeReferences.map((item) => item.name)
      : savedReferenceNames;
    const referenceText = referenceNames.length
      ? `同时参考收藏中的“${referenceNames.join("”、“")}”，提取其风格、配色、廓形和单品方向，不要完全复制。`
      : "";

    return {
      image: selectedOutfit.imagePrompt ?? `请基于上传的角色参考图，生成一张完整的数字人造型展示图。角色身份是“${form.role}”，内容主题是“${form.theme}”，场景为“${form.scene}”，季节为“${form.season}”。采用「${selectedOutfit.title}」方案：${fullLook}。${referenceText}整体风格为${styleText}，人物气质应当${selectedOutfit.tone}。${form.avoid ? `避免：${form.avoid}。` : ""}保持原角色的面部特征、年龄感、体型、肤色与发型识别度，重点准确呈现服装材质、颜色和轮廓。画面干净、自然光、全身或四分之三身构图，适合数字人角色展示。`,
      video: `以上传的角色图作为唯一人物参考。角色：${form.role}；内容：${form.theme}；场景：${form.scene}；季节：${form.season}。固定穿搭：${fullLook}。${referenceText}整体气质：${selectedOutfit.tone}。人物面向镜头进行自然讲解，动作克制，服装在运动中保持材质与结构稳定。镜头以中景为主，可轻微推进，光线柔和清晰。${form.avoid ? `不要出现：${form.avoid}。` : ""}所有镜头保持同一人脸、发型、体型、服装颜色、款式和配饰。`,
      consistency: selectedOutfit.consistency ?? `保持角色面部特征、肤色、年龄感、发型、体型和整体气质一致。全程锁定「${selectedOutfit.title}」造型：${selectedOutfit.top}、${selectedOutfit.bottom}、${selectedOutfit.shoes}、${selectedOutfit.accessory}。仅允许改变动作、表情和镜头角度，不改变服装颜色、版型、材质与配饰位置。`,
    };
  }, [activeReferences, form, generationStyles, savedReferenceNames, selectedOutfit]);

  function applyCodexHealth(health: LocalHealth) {
    const status = health.model.status ??
      (health.model.authenticated ? "connected" : "not_authenticated");
    setCliStatus(status);
    setCliBinary(health.model.binary ?? "");
    setLocalConnected(status === "connected");
    setLocalStatus(
      status === "connected"
        ? "Codex 已连接 · 本地文件模式"
        : status === "not_found"
          ? "未找到 Codex CLI"
          : "Codex CLI 尚未登录",
    );
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleStyle(style: string) {
    setStyles((current) =>
      current.includes(style)
        ? current.filter((item) => item !== style)
        : [...current, style],
    );
    setError("");
  }

  function addCustomTag() {
    const nextTag = customTagInput.trim().replace(/\s+/g, " ").slice(0, 20);
    if (!nextTag) return;
    if (generationStyles.includes(nextTag)) {
      setCustomTagInput("");
      setError("这个标签已经添加过了。");
      return;
    }
    if (customTags.length >= MAX_CUSTOM_TAGS) {
      setError(`自定义标签最多添加 ${MAX_CUSTOM_TAGS} 个。`);
      return;
    }
    setCustomTags((current) => [...current, nextTag]);
    setCustomTagInput("");
    setError("");
  }

  function removeCustomTag(tag: string) {
    setCustomTags((current) => current.filter((item) => item !== tag));
    setError("");
  }

  async function refreshCodexStatus(action: "detect" | "test" = "detect") {
    setCheckingCli(true);
    setCliMessage(action === "test" ? "正在测试 Codex 连接…" : "正在重新检测…");
    setCliStatus("checking");
    try {
      const health = await checkLocalHealth();
      applyCodexHealth(health);
      setCliMessage(
        health.model.status === "connected"
          ? action === "test"
            ? "连接测试通过，Codex 可以正常使用。"
            : "已检测到可用的 Codex CLI。"
          : health.model.status === "not_found"
            ? "没有找到可执行的 Codex CLI，可手动选择路径。"
            : "已找到 Codex CLI，但当前账号尚未登录。",
      );
    } catch {
      setLocalConnected(false);
      setCliStatus("service_offline");
      setCliBinary("");
      setLocalStatus("本地服务未连接");
      setCliMessage("本地服务没有响应，请重新启动应用后再试。");
    } finally {
      setCheckingCli(false);
    }
  }

  async function chooseCodexCliPath() {
    if (!window.stylingDesktop?.chooseCodexCli) return;
    const preference = await window.stylingDesktop.chooseCodexCli();
    if (!preference) return;
    setCliPreferenceMode(preference.mode);
    setCliConfiguredPath(preference.path);
    setCliMessage("已记住手动路径，正在测试连接…");
    await refreshCodexStatus("test");
  }

  async function useAutomaticCodexDetection() {
    if (!window.stylingDesktop?.useAutoCodexCli) return;
    const preference = await window.stylingDesktop.useAutoCodexCli();
    setCliPreferenceMode(preference.mode);
    setCliConfiguredPath(preference.path);
    setCliMessage("已恢复自动检测，正在查找 Codex CLI…");
    await refreshCodexStatus("detect");
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("请选择 JPG、PNG 或 WebP 图片。");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setCharacterFile(file);
    setCharacterImagePath("");
    setError("");
  }

  function compressFavoriteImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        const maxWidth = 760;
        const maxHeight = 950;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");

        if (!context) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("canvas-unavailable"));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", 0.76));
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("invalid-image"));
      };

      image.src = objectUrl;
    });
  }

  async function handleWardrobeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setWardrobeMessage("请选择 JPG、PNG 或 WebP 穿搭图片。");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setWardrobeMessage("图片请控制在 12MB 以内。");
      return;
    }

    try {
      const imageData = await compressFavoriteImage(file);
      const cleanName =
        file.name.replace(/\.[^.]+$/, "").trim().slice(0, 18) || "我的穿搭参考";
      const favorite: FavoriteLook = {
        id: `upload-${crypto.randomUUID()}`,
        name: cleanName,
        tags: ["自定义参考", "我的收藏"],
        source: "upload",
        imageData,
      };
      setFavorites((current) => [favorite, ...current]);
      setWardrobeMessage("穿搭图片已保存到本机收藏。");
    } catch {
      setWardrobeMessage("图片处理失败，请换一张图片再试。");
    }
  }

  async function chooseWardrobeFolder() {
    if (!window.stylingDesktop?.chooseWardrobeFolder) return;
    const selectedFolder = await window.stylingDesktop.chooseWardrobeFolder();
    if (selectedFolder) {
      setWardrobeFolder(selectedFolder);
      await scanWardrobeFolder(selectedFolder);
    }
  }

  async function scanWardrobeFolder(folderPath = wardrobeFolder) {
    if (!folderPath.trim()) {
      setWardrobeMessage("请先填写或选择本地衣柜文件夹。");
      return;
    }
    if (!localConnected) {
      setWardrobeMessage("本地服务尚未连接，当前仍可使用浏览器收藏。");
      return;
    }

    setScanningWardrobe(true);
    setWardrobeMessage("正在读取本地衣柜…");
    try {
      const result = await scanLocalWardrobe(folderPath.trim());
      setWardrobeFolder(result.root);
      setFolderImages(result.images);
      window.localStorage.setItem(WARDROBE_FOLDER_STORAGE_KEY, result.root);
      setWardrobeMessage(
        `已读取 ${result.total} 张图片${result.truncated ? "（已达到 500 张上限）" : ""}。`,
      );
    } catch (scanError) {
      setWardrobeMessage(
        scanError instanceof Error ? scanError.message : "本地衣柜读取失败。",
      );
    } finally {
      setScanningWardrobe(false);
    }
  }

  function makePlanName(planForm: FormState) {
    return `${planForm.theme || "穿搭方案"} · ${planForm.role || "数字角色"}`.slice(
      0,
      48,
    );
  }

  function savePlanSnapshot(plan: SavedPlan) {
    setSavedPlans((current) => [
      plan,
      ...current.filter((item) => item.id !== plan.id),
    ].slice(0, MAX_SAVED_PLANS));
    setPlansPage(1);
    setActivePlanId(plan.id);
    setPlanMessage(`已自动保存「${plan.name}」，可在“我的方案”中重新打开。`);
  }

  function updateActivePlan(patch: Partial<SavedPlan>) {
    if (!activePlanId) return;
    setSavedPlans((current) =>
      current.map((plan) =>
        plan.id === activePlanId
          ? { ...plan, ...patch, updatedAt: new Date().toISOString() }
          : plan,
      ),
    );
  }

  function openSavedPlan(plan: SavedPlan) {
    setForm({ ...plan.form });
    setStyles([...plan.styles]);
    setCustomTags([...plan.customTags]);
    setOutfits([...plan.outfits]);
    setSelectedId(plan.selectedId || "");
    setRunId(plan.runId);
    setRunCharacterPath(plan.characterImagePath);
    setRunReferencePaths([...plan.referencePaths]);
    setSavedReferenceNames([...plan.referenceNames]);
    setSelectedReferenceIds([...plan.referenceIds]);
    setUseFavoriteReferences(plan.referenceNames.length > 0);
    setActivePlanId(plan.id);
    setGenerated(true);
    setError("");
    setCopied("");
    setGenerationMessage(`已打开「${plan.name}」。`);
    window.setTimeout(
      () => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }

  function deleteSavedPlan(id: string) {
    const plan = savedPlans.find((item) => item.id === id);
    if (!plan || !window.confirm(`确定删除方案“${plan.name}”吗？`)) return;
    setSavedPlans((current) => current.filter((item) => item.id !== id));
    if (activePlanId === id) setActivePlanId("");
    setPlanMessage(`已删除「${plan.name}」。`);
  }

  function changePlansPage(page: number) {
    const nextPage = Math.max(1, Math.min(page, totalPlanPages));
    if (nextPage === currentPlansPage) return;
    setPlansPage(nextPage);
    window.setTimeout(
      () => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }

  function favoriteIdForOutfit(outfit: Outfit) {
    return `generated-${runId || activePlanId || "mock"}-${outfit.id}`;
  }

  function favoriteOutfit(outfit: Outfit) {
    const favoriteId = favoriteIdForOutfit(outfit);
    if (favorites.some((favorite) => favorite.id === favoriteId)) {
      setWardrobeMessage("这套方案已经在收藏衣柜中。");
      return;
    }

    setFavorites((current) => [
      {
        id: favoriteId,
        name: outfit.title,
        tags: outfit.tags.slice(0, 3),
        source: "generated",
        swatches: outfit.swatches,
        imagePath: outfit.previewPath,
        previewUrl: outfit.previewUrl,
      },
      ...current,
    ]);
    setWardrobeMessage(`已收藏「${outfit.title}」。`);
  }

  function deleteFavorite(id: string) {
    if (id.startsWith("folder-")) {
      const folderId = id.slice("folder-".length);
      setFolderImages((current) => current.filter((image) => image.id !== folderId));
    } else {
      setFavorites((current) => current.filter((favorite) => favorite.id !== id));
    }
    setSelectedReferenceIds((current) => current.filter((item) => item !== id));
    setWardrobeMessage(
      id.startsWith("folder-")
        ? "已从当前列表移除，原文件没有删除。"
        : "已从收藏衣柜删除。",
    );
  }

  function toggleReference(id: string) {
    setSelectedReferenceIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setError("");
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!form.role.trim() || !form.theme.trim() || !form.scene.trim()) {
      setError("请先填写角色身份、内容主题和场景。");
      return;
    }
    if (!generationStyles.length) {
      setError("请至少选择一个风格方向。");
      return;
    }
    if (useFavoriteReferences && !selectedReferenceIds.length) {
      setError("已开启“参考我的收藏”，请至少选择一张收藏图片。");
      return;
    }

    setError("");
    setSelectedId("");
    setCopied("");
    setGeneratingOutfits(true);

    try {
      if (localConnected) {
        if (!characterFile && !characterImagePath) {
          throw new Error("使用 Codex 生成真实方案前，请先上传角色参考图。");
        }
        setGenerationMessage("正在准备角色与收藏参考…");
        let currentCharacterPath = characterImagePath;
        if (!currentCharacterPath && characterFile) {
          const imported = await importLocalAsset(characterFile, "characters");
          currentCharacterPath = imported.imagePath;
          setCharacterImagePath(imported.imagePath);
        }

        const referencePaths: string[] = [];
        for (const reference of activeReferences) {
          if (reference.imagePath) {
            referencePaths.push(reference.imagePath);
            continue;
          }
          if (reference.imageData) {
            const imported = await importDataUrlAsset(
              reference.imageData,
              `${reference.name}.jpg`,
            );
            referencePaths.push(imported.imagePath);
          }
        }

        setGenerationMessage(
          `Codex 正在分析角色${referencePaths.length ? `与 ${referencePaths.length} 张收藏参考` : ""}…`,
        );
        const result = await analyzeWithCodex({
          characterImage: currentCharacterPath,
          referenceImages: referencePaths,
          role: form.role,
          theme: form.theme,
          scene: form.scene,
          season: form.season,
          styles: generationStyles,
          avoid: form.avoid,
        });
        const nextOutfits = result.plan.outfits.map((outfit, index) => ({
          ...outfit,
          eyebrow: outfit.direction || `方向 0${index + 1}`,
        }));
        const referenceNames = activeReferences.map((reference) => reference.name);
        const planId = `plan-${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();
        setOutfits(nextOutfits);
        setRunId(result.runId);
        setRunCharacterPath(currentCharacterPath);
        setRunReferencePaths(referencePaths);
        setSavedReferenceNames(referenceNames);
        savePlanSnapshot({
          id: planId,
          name: makePlanName(form),
          createdAt: timestamp,
          updatedAt: timestamp,
          form: { ...form },
          styles: [...styles],
          customTags: [...customTags],
          outfits: nextOutfits,
          selectedId: "",
          runId: result.runId,
          characterImagePath: currentCharacterPath,
          referencePaths: [...referencePaths],
          referenceIds: [...selectedReferenceIds],
          referenceNames,
        });
        setGenerationMessage("已生成 3 套真实穿搭方向，结果已保存到本地。");
      } else {
        const nextOutfits = OUTFITS.map((outfit) => ({ ...outfit }));
        const referenceNames = activeReferences.map((reference) => reference.name);
        const planId = `plan-${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();
        setOutfits(nextOutfits);
        setRunId("");
        setRunCharacterPath("");
        setRunReferencePaths([]);
        setSavedReferenceNames(referenceNames);
        savePlanSnapshot({
          id: planId,
          name: makePlanName(form),
          createdAt: timestamp,
          updatedAt: timestamp,
          form: { ...form },
          styles: [...styles],
          customTags: [...customTags],
          outfits: nextOutfits,
          selectedId: "",
          runId: "",
          characterImagePath: "",
          referencePaths: [],
          referenceIds: [...selectedReferenceIds],
          referenceNames,
        });
        setGenerationMessage("当前使用模拟方案；启动本地服务后可调用 Codex。");
      }

      setGenerated(true);
      window.setTimeout(
        () =>
          document
            .getElementById("results")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        80,
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "穿搭方案生成失败，请稍后再试。",
      );
      setGenerationMessage("");
    } finally {
      setGeneratingOutfits(false);
    }
  }

  async function generatePreview(outfit: Outfit) {
    if (!localConnected || !runId || !runCharacterPath) {
      setError("请先通过本地 Codex 生成真实穿搭方案，再生成预览图。");
      return;
    }
    if (!outfit.imagePrompt || !outfit.consistency) {
      setError("当前方案缺少生图提示词，请重新生成方案。");
      return;
    }

    setError("");
    setGeneratingPreviewId(outfit.id);
    setGenerationMessage(`正在生成「${outfit.title}」预览图，通常需要几分钟…`);
    try {
      const result = await generateWithCodex(runId, {
        characterImage: runCharacterPath,
        referenceImages: runReferencePaths,
        outfitId: outfit.id,
        imagePrompt: outfit.imagePrompt,
        consistency: outfit.consistency,
      });
      const nextOutfits = outfits.map((item) =>
        item.id === outfit.id
          ? {
              ...item,
              previewUrl: result.previewUrl,
              previewPath: result.imagePath,
            }
          : item,
      );
      setOutfits(nextOutfits);
      updateActivePlan({ outfits: nextOutfits });
      setGenerationMessage(
        `「${outfit.title}」预览图已生成并保存到本地结果文件夹。`,
      );
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "预览图生成失败，请稍后重试。",
      );
      setGenerationMessage("");
    } finally {
      setGeneratingPreviewId("");
    }
  }

  async function savePreviewImage(outfit: Outfit) {
    if (!outfit.previewUrl) {
      setError("请先生成穿搭预览图。");
      return;
    }

    setError("");
    setSavingPreviewId(outfit.id);
    try {
      const suggestedName = `${outfit.title}-穿搭预览`;
      if (
        outfit.previewPath &&
        window.stylingDesktop?.saveGeneratedImage
      ) {
        const savedPath = await window.stylingDesktop.saveGeneratedImage(
          outfit.previewPath,
          suggestedName,
        );
        if (savedPath) {
          setGenerationMessage(`图片已单独保存到：${savedPath}`);
        }
        return;
      }

      const response = await fetch(outfit.previewUrl);
      if (!response.ok) throw new Error("图片读取失败");
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${suggestedName}.png`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      setGenerationMessage("图片已下载到浏览器默认下载位置。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "图片保存失败，请重试。",
      );
    } finally {
      setSavingPreviewId("");
    }
  }

  function chooseOutfit(id: string) {
    setSelectedId(id);
    updateActivePlan({ selectedId: id });
    setCopied("");
    window.setTimeout(
      () => document.getElementById("prompts")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("复制失败，请手动选择文字复制。");
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="回到页面顶部">
          <span className="brand-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/app-icon.png" alt="" aria-hidden="true" />
          </span>
          <span>角色造型室</span>
        </a>
        <div className="header-actions">
          <nav aria-label="页面导航">
            <a href="#styling-input">生成穿搭</a>
            <a className="wardrobe-nav-link" href="#wardrobe">
              我的收藏衣柜
              <span>{wardrobeItems.length}</span>
            </a>
            <a className="wardrobe-nav-link" href="#plans">
              我的方案
              <span>{savedPlans.length}</span>
            </a>
            <button
              className="mobile-cli-trigger"
              type="button"
              aria-label="打开 Codex CLI 设置"
              onClick={() => setCliSettingsOpen((current) => !current)}
            >
              CLI
            </button>
          </nav>
          <button
            className={`prototype-badge cli-settings-trigger ${localConnected ? "local-online" : ""}`}
            type="button"
            aria-expanded={cliSettingsOpen}
            onClick={() => setCliSettingsOpen((current) => !current)}
          >
            <span />
            {localStatus}
          </button>
        </div>
      </header>

      {cliSettingsOpen && (
        <aside className="cli-settings-panel" aria-label="Codex CLI 设置">
          <div className="cli-settings-heading">
            <div>
              <p>本地模型</p>
              <h2>Codex CLI 设置</h2>
            </div>
            <button
              type="button"
              aria-label="关闭 Codex CLI 设置"
              onClick={() => setCliSettingsOpen(false)}
            >
              ×
            </button>
          </div>

          <div className={`cli-connection-state status-${cliStatus}`}>
            <span aria-hidden="true" />
            <div>
              <strong>
                {cliStatus === "connected"
                  ? "已连接"
                  : cliStatus === "not_found"
                    ? "未找到"
                    : cliStatus === "not_authenticated"
                      ? "未登录"
                      : cliStatus === "checking"
                        ? "检测中"
                        : "本地服务未连接"}
              </strong>
              <small>
                {cliStatus === "connected"
                  ? "可以分析角色并生成穿搭预览图"
                  : cliStatus === "not_found"
                    ? "请安装 Codex，或手动选择可执行文件"
                    : cliStatus === "not_authenticated"
                      ? "请先在 ChatGPT / Codex 中完成登录"
                      : cliStatus === "checking"
                        ? "正在检查本机 Codex 状态"
                        : "请重新启动角色造型室"}
              </small>
            </div>
          </div>

          <dl className="cli-path-summary">
            <div>
              <dt>检测方式</dt>
              <dd>{cliPreferenceMode === "manual" ? "手动路径" : "自动检测"}</dd>
            </div>
            <div>
              <dt>{cliPreferenceMode === "manual" ? "已保存路径" : "当前路径"}</dt>
              <dd title={cliConfiguredPath || cliBinary || "尚未检测到路径"}>
                {cliConfiguredPath || cliBinary || "尚未检测到路径"}
              </dd>
            </div>
          </dl>

          <div className="cli-settings-actions">
            <button
              type="button"
              disabled={checkingCli}
              onClick={() => void refreshCodexStatus("detect")}
            >
              重新检测
            </button>
            <button
              type="button"
              disabled={checkingCli}
              onClick={() => void refreshCodexStatus("test")}
            >
              测试连接
            </button>
            {desktopMode && (
              <button
                className="primary-cli-action"
                type="button"
                disabled={checkingCli}
                onClick={() => void chooseCodexCliPath()}
              >
                手动选择 CLI
              </button>
            )}
          </div>

          {desktopMode && cliPreferenceMode === "manual" && (
            <button
              className="cli-auto-button"
              type="button"
              disabled={checkingCli}
              onClick={() => void useAutomaticCodexDetection()}
            >
              恢复自动检测
            </button>
          )}
          {cliMessage && <p className="cli-settings-message" role="status">{cliMessage}</p>}
        </aside>
      )}

      <div className="page-shell" id="top">
        <section className="hero">
          <p className="kicker">DIGITAL CHARACTER STYLING</p>
          <h1>为数字角色，<br />找到合适的穿搭方向。</h1>
          <p className="hero-copy">
            从角色参考到生成提示词，三步完成造型选择。
          </p>

          <figure className="hero-illustration" aria-label="角色衣柜插图">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hero-wardrobe.png" alt="挥手的角色衣柜" />
          </figure>

          <div className="hero-feature-flow" aria-label="三步完成角色造型">
            <article className="hero-feature">
              <div className="hero-feature-icon" aria-hidden="true">01</div>
              <div>
                <p className="hero-feature-title">上传角色</p>
                <p className="hero-feature-copy">数字人或角色设定图</p>
              </div>
            </article>

            <span className="hero-flow-arrow" aria-hidden="true" />

            <article className="hero-feature">
              <div className="hero-feature-icon" aria-hidden="true">02</div>
              <div>
                <p className="hero-feature-title">选择穿搭</p>
                <p className="hero-feature-copy">场景、季节、风格与收藏参考</p>
              </div>
            </article>

            <span className="hero-flow-arrow" aria-hidden="true" />

            <article className="hero-feature">
              <div className="hero-feature-icon" aria-hidden="true">03</div>
              <div>
                <p className="hero-feature-title">生成提示词</p>
                <p className="hero-feature-copy">用于生图、视频及其他 AI 创作工具</p>
              </div>
            </article>
          </div>
        </section>

        <section className="wardrobe-section" id="wardrobe">
          <div className="section-heading">
            <div>
              <p className="section-number">我的收藏衣柜</p>
              <h2>把喜欢的方向留在这里</h2>
            </div>
            <p>连接分类文件夹、上传外部参考，或收藏下方生成的方案。</p>
          </div>

          <div className="wardrobe-toolbar">
            <div>
              <strong>{wardrobeItems.length} 个参考</strong>
              <span>可在生成时选择一张或多张作为风格参考</span>
            </div>
            <button type="button" onClick={() => wardrobeFileRef.current?.click()}>
              <span aria-hidden="true">＋</span>
              上传穿搭参考图
            </button>
            <input
              ref={wardrobeFileRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleWardrobeUpload}
              aria-label="上传穿搭参考图"
            />
          </div>

          <div className="folder-connector">
            <div>
              <strong>本地衣柜文件夹</strong>
              <span>按现有子文件夹分类读取，不移动或删除原图</span>
            </div>
            <div className="folder-path-controls">
              <input
                value={wardrobeFolder}
                onChange={(event) => setWardrobeFolder(event.target.value)}
                placeholder="/你的/穿搭参考文件夹"
                aria-label="本地衣柜文件夹路径"
              />
              {desktopMode && (
                <button type="button" onClick={() => void chooseWardrobeFolder()}>
                  选择文件夹
                </button>
              )}
              <button
                type="button"
                disabled={scanningWardrobe || !localConnected}
                onClick={() => void scanWardrobeFolder()}
              >
                {scanningWardrobe ? "读取中…" : "读取衣柜"}
              </button>
            </div>
          </div>

          {wardrobeItems.length ? (
            <div className="wardrobe-grid">
              {wardrobeItems.map((favorite) => (
                <article className="wardrobe-card" key={favorite.id}>
                  <div className="wardrobe-image">
                    <FavoritePreview favorite={favorite} />
                    <button
                      className="delete-favorite"
                      type="button"
                      onClick={() => deleteFavorite(favorite.id)}
                      aria-label={`删除${favorite.name}`}
                      title="删除收藏"
                    >
                      ×
                    </button>
                    <span className="favorite-source">
                      {favorite.source === "upload"
                        ? "我的图片"
                        : favorite.source === "folder"
                          ? "本地文件夹"
                          : "方案收藏"}
                    </span>
                  </div>
                  <div className="wardrobe-card-copy">
                    <h3>{favorite.name}</h3>
                    <div className="favorite-tags">
                      {favorite.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <button
              className="wardrobe-empty"
              type="button"
              onClick={() => wardrobeFileRef.current?.click()}
            >
              <span aria-hidden="true">＋</span>
              <strong>收藏衣柜还是空的</strong>
              <small>先上传一张喜欢的穿搭图，或从生成方案中点击“收藏”</small>
            </button>
          )}

          {wardrobeMessage && (
            <p className="wardrobe-message" role="status">{wardrobeMessage}</p>
          )}
        </section>

        <section className="plans-section" id="plans">
          <div className="section-heading">
            <div>
              <p className="section-number">我的方案</p>
              <h2>把生成过的方向留存下来</h2>
            </div>
            <p>每次生成后会自动保存，可随时重新打开方案和提示词。</p>
          </div>

          {savedPlans.length ? (
            <div className="plans-grid">
              {visibleSavedPlans.map((plan) => {
                const firstOutfit = plan.outfits[0];
                const isActive = plan.id === activePlanId;
                return (
                  <article className={`plan-card ${isActive ? "active" : ""}`} key={plan.id}>
                    <div className="plan-card-preview">
                      <div className="plan-card-preview-label">
                        <span>STYLE PLAN</span>
                        <small>{new Date(plan.createdAt).toLocaleDateString("zh-CN")}</small>
                      </div>
                      <div className="plan-card-swatches" aria-label="方案色彩">
                        {(firstOutfit?.swatches ?? ["#e2ded4", "#929a91", "#c6b79d"]).map((color) => (
                          <span key={color} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                      <div className="plan-card-direction-count">
                        {plan.outfits.length} 个方向
                      </div>
                    </div>
                    <div className="plan-card-content">
                      <div className="plan-card-title-row">
                        <h3>{plan.name}</h3>
                        {isActive && <span>当前</span>}
                      </div>
                      <p className="plan-card-date">
                        {new Date(plan.updatedAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })} 更新
                      </p>
                      <div className="plan-card-meta">
                        <span>{plan.form.scene}</span>
                        <span>{plan.form.season}</span>
                        <span>{plan.styles.join(" · ")}</span>
                      </div>
                      <p className="plan-card-outfits">
                        {plan.outfits.map((outfit) => outfit.title).join(" / ")}
                      </p>
                    </div>
                    <div className="plan-card-actions">
                      <button type="button" onClick={() => openSavedPlan(plan)}>
                        打开方案 <span aria-hidden="true">→</span>
                      </button>
                      <button
                        type="button"
                        className="plan-delete-button"
                        onClick={() => deleteSavedPlan(plan.id)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="plans-empty">
              <span aria-hidden="true">01</span>
              <div>
                <strong>还没有保存的方案</strong>
                <p>完成一次穿搭生成后，方案会自动出现在这里。</p>
              </div>
              <a href="#styling-input">去生成方案 →</a>
            </div>
          )}

          {savedPlans.length > 0 && (
            <div className="plans-footer">
              {planMessage
                ? <p className="plan-message" role="status">{planMessage}</p>
                : <span />}
              <nav className="plans-pagination" aria-label="我的方案分页">
                <button
                  type="button"
                  disabled={currentPlansPage === 1}
                  onClick={() => changePlansPage(currentPlansPage - 1)}
                  aria-label="上一页方案"
                >
                  <span aria-hidden="true">←</span> 上一页
                </button>
                <span className="plans-page-status" aria-live="polite">
                  第 {currentPlansPage} / {totalPlanPages} 页
                </span>
                <button
                  type="button"
                  disabled={currentPlansPage === totalPlanPages}
                  onClick={() => changePlansPage(currentPlansPage + 1)}
                  aria-label="下一页方案"
                >
                  下一页 <span aria-hidden="true">→</span>
                </button>
              </nav>
            </div>
          )}
        </section>

        <form className="input-section" id="styling-input" onSubmit={handleGenerate}>
          <div className="section-heading">
            <div>
              <p className="section-number">01 / 输入</p>
              <h2>这次，角色要去哪里？</h2>
            </div>
            <p>带 * 为必填。角色图只在本地预览，收藏和我的方案只保存在当前浏览器。</p>
          </div>

          <div className="input-grid">
            <div className="upload-column">
              <label className="field-label" htmlFor="character-image">角色参考图</label>
              <button
                className={`upload-box ${previewUrl ? "has-image" : ""}`}
                type="button"
                onClick={() => fileRef.current?.click()}
              >
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="已上传的角色预览" />
                ) : (
                  <UploadPlaceholder />
                )}
                <span className="upload-action">{previewUrl ? "更换图片" : "选择本地图片"}</span>
              </button>
              <input
                ref={fileRef}
                className="visually-hidden"
                id="character-image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFile}
              />
              <p className="file-note">
                {fileName || "可跳过，使用角色占位图继续体验"}
              </p>
            </div>

            <div className="form-column">
              <div className="form-row two-columns">
                <label>
                  <span className="field-label">角色身份 *</span>
                  <input
                    value={form.role}
                    onChange={(event) => updateField("role", event.target.value)}
                    placeholder="例如：年轻档案管理员"
                  />
                </label>
                <label>
                  <span className="field-label">内容主题 *</span>
                  <input
                    value={form.theme}
                    onChange={(event) => updateField("theme", event.target.value)}
                    placeholder="例如：AI 工具教程"
                  />
                </label>
              </div>

              <div className="form-row two-columns">
                <label>
                  <span className="field-label">场景 *</span>
                  <input
                    value={form.scene}
                    onChange={(event) => updateField("scene", event.target.value)}
                    placeholder="例如：干净的数字档案室"
                  />
                </label>
                <label>
                  <span className="field-label">季节</span>
                  <select
                    value={form.season}
                    onChange={(event) => updateField("season", event.target.value)}
                  >
                    <option>春季</option>
                    <option>夏季</option>
                    <option>秋季</option>
                    <option>冬季</option>
                    <option>不限</option>
                  </select>
                </label>
              </div>

              <fieldset className="style-field">
                <legend className="field-label">风格方向 * <small>可多选</small></legend>
                <div className="style-options">
                  {STYLE_OPTIONS.map((style) => {
                    const selected = styles.includes(style);
                    return (
                      <button
                        className={selected ? "selected" : ""}
                        type="button"
                        key={style}
                        aria-pressed={selected}
                        onClick={() => toggleStyle(style)}
                      >
                        {selected && <span>✓</span>}
                        {style}
                      </button>
                    );
                  })}
                </div>
                <div className="custom-tag-field">
                  <label htmlFor="custom-style-tag">
                    <span>补充标签</span>
                    <small>输入更具体的造型方向，按回车添加</small>
                  </label>
                  <div className="custom-tag-controls">
                    <input
                      id="custom-style-tag"
                      value={customTagInput}
                      maxLength={20}
                      placeholder="例如：法式复古、低饱和机能"
                      onChange={(event) => setCustomTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addCustomTag();
                      }}
                    />
                    <button
                      type="button"
                      disabled={!customTagInput.trim()}
                      onClick={addCustomTag}
                    >
                      添加
                    </button>
                  </div>
                  {customTags.length > 0 && (
                    <div className="custom-tag-list" aria-label="已添加的自定义标签">
                      {customTags.map((tag) => (
                        <span key={tag}>
                          {tag}
                          <button
                            type="button"
                            aria-label={`删除标签${tag}`}
                            onClick={() => removeCustomTag(tag)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </fieldset>

              <label>
                <span className="field-label">避免方向</span>
                <textarea
                  value={form.avoid}
                  onChange={(event) => updateField("avoid", event.target.value)}
                  placeholder="例如：不要太商务，不要太花哨"
                  rows={3}
                />
              </label>
            </div>
          </div>

          <div className={`favorite-reference-panel ${useFavoriteReferences ? "open" : ""}`}>
            <label className="reference-toggle">
              <span>
                <strong>参考我的收藏</strong>
                <small>用收藏图辅助判断配色、廓形和单品方向</small>
              </span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  checked={useFavoriteReferences}
                  onChange={(event) => {
                    setUseFavoriteReferences(event.target.checked);
                    setError("");
                  }}
                />
                <span aria-hidden="true" />
              </span>
            </label>

            {useFavoriteReferences && (
              <div className="reference-picker">
                <div className="reference-picker-heading">
                  <div>
                    <strong>选择穿搭参考</strong>
                    <span>可多选 · 已选 {selectedReferenceIds.length} 张</span>
                  </div>
                  {selectedReferenceIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedReferenceIds([])}
                    >
                      清除选择
                    </button>
                  )}
                </div>

                {wardrobeItems.length ? (
                  <div className="reference-grid">
                    {wardrobeItems.map((favorite) => {
                      const selected = selectedReferenceIds.includes(favorite.id);
                      return (
                        <button
                          className={`reference-card ${selected ? "selected" : ""}`}
                          type="button"
                          key={favorite.id}
                          onClick={() => toggleReference(favorite.id)}
                          aria-pressed={selected}
                        >
                          <span className="reference-card-image">
                            <FavoritePreview favorite={favorite} />
                            <span className="reference-check" aria-hidden="true">
                              {selected ? "✓" : ""}
                            </span>
                          </span>
                          <span className="reference-card-name">{favorite.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    className="reference-empty"
                    type="button"
                    onClick={() => wardrobeFileRef.current?.click()}
                  >
                    收藏衣柜还没有图片，先上传一张穿搭参考
                    <span aria-hidden="true">→</span>
                  </button>
                )}

                <p className="reference-note">
                  参考图只用于提取风格、配色、廓形与单品方向，不要求完全复制。
                </p>
              </div>
            )}
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}

          <div className="submit-row">
            <p>
              {generationMessage ||
                (activeReferences.length
                  ? `将结合 ${activeReferences.length} 张收藏参考生成`
                  : localConnected
                    ? "将调用本机 Codex，通常需要 1–3 分钟"
                    : "演示模式：立即展示模拟方案")}
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={generatingOutfits}
            >
              {generatingOutfits ? "Codex 分析中…" : "生成 3 套穿搭方向"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>

        {generated && (
          <section className="results-section" id="results">
            <div className="section-heading">
              <div>
                <p className="section-number">02 / 比较</p>
                <h2>三种明确不同的方向</h2>
              </div>
              <p>先判断气质和内容是否匹配，不必纠结单件衣物。</p>
            </div>

            {activeReferences.length > 0 && (
              <div className="reference-used-banner">
                <span>收藏参考已加入</span>
                <p>
                  本轮结合了
                  {activeReferences.map((favorite) => `「${favorite.name}」`).join("、")}
                  的配色、廓形和单品方向。
                </p>
              </div>
            )}

            <div className="outfit-grid">
              {outfits.map((outfit) => {
                const selected = outfit.id === selectedId;
                const favorited = favorites.some(
                  (favorite) => favorite.id === favoriteIdForOutfit(outfit),
                );
                return (
                  <article className={`outfit-card ${selected ? "selected" : ""}`} key={outfit.id}>
                    <div
                      className={`look-preview ${outfit.previewUrl ? "has-generated-image" : ""}`}
                      aria-label={`${outfit.title} 色彩示意`}
                    >
                      {outfit.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="generated-look-image"
                          src={outfit.previewUrl}
                          alt={`${outfit.title}生成预览`}
                        />
                      ) : (
                        <>
                          <div className="swatches">
                            {outfit.swatches.map((color) => (
                              <span key={color} style={{ backgroundColor: color }} />
                            ))}
                          </div>
                          <div className="look-figure">
                            <span className="figure-head" />
                            <span className="figure-top" style={{ backgroundColor: outfit.swatches[0] }} />
                            <span className="figure-bottom" style={{ backgroundColor: outfit.swatches[1] }} />
                          </div>
                        </>
                      )}
                      <span className="look-label">{outfit.eyebrow}</span>
                    </div>
                    <div className="outfit-content">
                      <div className="outfit-title-row">
                        <h3>{outfit.title}</h3>
                        {selected && <span className="selected-mark">已选择</span>}
                      </div>
                      <p className="outfit-summary">{outfit.summary}</p>
                      <div className="tags">
                        {outfit.tags.map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                      <dl>
                        <div><dt>上装</dt><dd>{outfit.top}</dd></div>
                        <div><dt>下装</dt><dd>{outfit.bottom}</dd></div>
                        <div><dt>鞋履</dt><dd>{outfit.shoes}</dd></div>
                        <div><dt>配饰</dt><dd>{outfit.accessory}</dd></div>
                        <div><dt>发型</dt><dd>{outfit.hair}</dd></div>
                        <div><dt>气质</dt><dd>{outfit.tone}</dd></div>
                        <div><dt>适合</dt><dd>{outfit.fit}</dd></div>
                      </dl>
                      <div className="card-actions">
                        <button
                          className={`favorite-button ${favorited ? "favorited" : ""}`}
                          type="button"
                          onClick={() => favoriteOutfit(outfit)}
                        >
                          <span aria-hidden="true">{favorited ? "♥" : "♡"}</span>
                          {favorited ? "已收藏" : "收藏"}
                        </button>
                        <button
                          className={selected ? "card-button selected" : "card-button"}
                          type="button"
                          onClick={() => chooseOutfit(outfit.id)}
                        >
                          {selected ? "已选定" : "选择此方案"}
                          <span aria-hidden="true">{selected ? "✓" : "→"}</span>
                        </button>
                      </div>
                      {localConnected && runId && (
                        <div className="preview-actions">
                          <button
                            className="preview-generation-button"
                            type="button"
                            disabled={Boolean(generatingPreviewId || savingPreviewId)}
                            onClick={() => void generatePreview(outfit)}
                          >
                            {generatingPreviewId === outfit.id
                              ? "正在生成预览图…"
                              : outfit.previewUrl
                                ? "重新生成预览图"
                                : "生成穿搭预览图"}
                          </button>
                          {outfit.previewUrl && (
                            <button
                              className="save-preview-button"
                              type="button"
                              disabled={Boolean(generatingPreviewId || savingPreviewId)}
                              onClick={() => void savePreviewImage(outfit)}
                            >
                              {savingPreviewId === outfit.id ? "保存中…" : "单独保存图片"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {selectedOutfit && promptSet && (
          <section className="prompt-section" id="prompts">
            <div className="section-heading">
              <div>
                <p className="section-number">03 / 输出</p>
                <h2>「{selectedOutfit.title}」生成指令</h2>
              </div>
              <p>
                {runId
                  ? "提示词由本机 Codex 生成，方案和预览图会保存到本地。"
                  : "这是模拟初稿，可直接复制后再按工具微调。"}
              </p>
            </div>

            <div className="prompt-layout">
              <div className="prompt-main">
                <article className="prompt-card">
                  <div className="prompt-card-heading">
                    <div><span>01</span><h3>生图提示词</h3></div>
                    <button type="button" onClick={() => copyText("image", promptSet.image)}>
                      {copied === "image" ? "已复制 ✓" : "复制"}
                    </button>
                  </div>
                  <p>{promptSet.image}</p>
                </article>

                <article className="prompt-card">
                  <div className="prompt-card-heading">
                    <div><span>02</span><h3>视频提示词</h3></div>
                    <button type="button" onClick={() => copyText("video", promptSet.video)}>
                      {copied === "video" ? "已复制 ✓" : "复制"}
                    </button>
                  </div>
                  <p>{promptSet.video}</p>
                </article>

                <article className="prompt-card compact">
                  <div className="prompt-card-heading">
                    <div><span>03</span><h3>角色一致性说明</h3></div>
                    <button type="button" onClick={() => copyText("consistency", promptSet.consistency)}>
                      {copied === "consistency" ? "已复制 ✓" : "复制"}
                    </button>
                  </div>
                  <p>{promptSet.consistency}</p>
                </article>
              </div>

              <aside className="selection-summary">
                <p className="summary-kicker">已选方案</p>
                <h3>{selectedOutfit.title}</h3>
                <div className="summary-swatches">
                  {selectedOutfit.swatches.map((color) => (
                    <span key={color} style={{ backgroundColor: color }} />
                  ))}
                </div>
                <dl>
                  <div><dt>角色</dt><dd>{form.role}</dd></div>
                  <div><dt>内容</dt><dd>{form.theme}</dd></div>
                  <div><dt>场景</dt><dd>{form.scene}</dd></div>
                  <div><dt>风格</dt><dd>{generationStyles.join(" · ")}</dd></div>
                  {activeReferences.length > 0 && (
                    <div>
                      <dt>收藏参考</dt>
                      <dd>{activeReferences.map((item) => item.name).join(" · ")}</dd>
                    </div>
                  )}
                </dl>
                <button
                  type="button"
                  className="copy-all-button"
                  onClick={() =>
                    copyText(
                      "all",
                      `【生图提示词】\n${promptSet.image}\n\n【视频提示词】\n${promptSet.video}\n\n【角色一致性说明】\n${promptSet.consistency}`,
                    )
                  }
                >
                  {copied === "all" ? "全部已复制 ✓" : "复制全部提示词"}
                </button>
              </aside>
            </div>

            <div className="prototype-end">
              <span>{activePlanId ? "本次结果已保存到我的方案" : "演示流程结束"}</span>
              <p>
                {activePlanId
                  ? "可继续生成选中方案的预览图，也可以从顶部“我的方案”重新打开历史记录。"
                  : "启动本地服务后，可使用 Codex 生成真实方案与预览图。"}
              </p>
            </div>
          </section>
        )}
      </div>

      <footer>
        <p>角色造型室 · 本地个人版</p>
        <p>{localConnected ? "Codex CLI + 本地文件夹存储" : "演示模式 · 本地服务未连接"}</p>
      </footer>
    </main>
  );
}
