import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ShoppingCart, ShoppingBag, ShoppingBasket, Store, Apple, Carrot, Wheat, Milk, Egg,
  Coffee, Cookie, IceCream, Pizza, Sandwich, Soup, Salad, Fish, Beef, Droplet, Shirt,
  Footprints, Watch, Gem, Baby, Glasses, Laptop, Smartphone, Headphones, Tv, Camera,
  Home, Sofa, Lamp, UtensilsCrossed, Wrench, Hammer, PaintBucket, Palette, Scissors,
  Gift, Package, Tag, Sparkles, Flower2, Leaf, Bike, Dumbbell, Heart, Pill,
  Stethoscope, BookOpen, PawPrint, Music, Search,
} from 'lucide-react';
import { useAdmin } from '../context/AdminContext';
import { authGet, authPost, authDelete, authPut } from '../../../utils/adminApi';

/**
 * Category-relevant subset of Lucide (MIT) — matches the stroke-based,
 * 24x24, rounded-cap style every hand-drawn icon in this admin panel
 * already uses, so a picked icon doesn't look imported from elsewhere.
 */
const CATEGORY_ICONS = [
  { name: 'Shopping Cart', Icon: ShoppingCart }, { name: 'Shopping Bag', Icon: ShoppingBag },
  { name: 'Basket', Icon: ShoppingBasket }, { name: 'Store', Icon: Store },
  { name: 'Apple', Icon: Apple }, { name: 'Carrot', Icon: Carrot },
  { name: 'Wheat', Icon: Wheat }, { name: 'Milk', Icon: Milk }, { name: 'Egg', Icon: Egg },
  { name: 'Coffee', Icon: Coffee }, { name: 'Cookie', Icon: Cookie }, { name: 'Ice Cream', Icon: IceCream },
  { name: 'Pizza', Icon: Pizza }, { name: 'Sandwich', Icon: Sandwich }, { name: 'Soup', Icon: Soup },
  { name: 'Salad', Icon: Salad }, { name: 'Fish', Icon: Fish }, { name: 'Meat', Icon: Beef },
  { name: 'Oil / Ghee', Icon: Droplet }, { name: 'Clothing', Icon: Shirt },
  { name: 'Footwear', Icon: Footprints }, { name: 'Watch', Icon: Watch }, { name: 'Jewellery', Icon: Gem },
  { name: 'Baby', Icon: Baby }, { name: 'Eyewear', Icon: Glasses }, { name: 'Laptop', Icon: Laptop },
  { name: 'Mobile', Icon: Smartphone }, { name: 'Headphones', Icon: Headphones }, { name: 'TV', Icon: Tv },
  { name: 'Camera', Icon: Camera }, { name: 'Home', Icon: Home }, { name: 'Furniture', Icon: Sofa },
  { name: 'Lighting', Icon: Lamp }, { name: 'Kitchenware', Icon: UtensilsCrossed },
  { name: 'Hardware', Icon: Wrench }, { name: 'Tools', Icon: Hammer }, { name: 'Paint', Icon: PaintBucket },
  { name: 'Handicraft', Icon: Palette }, { name: 'Tailoring', Icon: Scissors }, { name: 'Gifts', Icon: Gift },
  { name: 'Package', Icon: Package }, { name: 'Tag / Offers', Icon: Tag }, { name: 'Featured', Icon: Sparkles },
  { name: 'Flowers', Icon: Flower2 }, { name: 'Organic', Icon: Leaf }, { name: 'Cycles', Icon: Bike },
  { name: 'Fitness', Icon: Dumbbell }, { name: 'Wellness', Icon: Heart }, { name: 'Pharmacy', Icon: Pill },
  { name: 'Healthcare', Icon: Stethoscope }, { name: 'Books & Stationery', Icon: BookOpen },
  { name: 'Pet Care', Icon: PawPrint }, { name: 'Music', Icon: Music },
];

/**
 * Renders a Lucide icon component off-screen and reads back real SVG
 * markup, so a picked icon can go through the exact same Cloudinary
 * upload path a hand-picked image file already does — nothing downstream
 * (FormData building, the storefront's <img src=...>) needs to know the
 * difference between the two.
 */
const lucideIconToFile = (IconComponent, name) => {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const root = createRoot(container);
  flushSync(() => {
    root.render(<IconComponent size={64} strokeWidth={1.75} color="#111111" />);
  });

  const svgEl = container.querySelector('svg');
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const markup = svgEl.outerHTML;

  root.unmount();
  document.body.removeChild(container);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return new File([new Blob([markup], { type: 'image/svg+xml' })], `${slug}.svg`, { type: 'image/svg+xml' });
};

/** Searchable grid of curated category icons, opened from "Select Icon". */
const IconPickerModal = ({ onPick, onClose }) => {
  const [q, setQ] = useState('');
  const filtered = CATEGORY_ICONS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <ModalPortal
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '78vh', background: '#fff', borderRadius: 16,
          display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px -12px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0f172a' }}>Select an Icon</h4>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        <div style={{ padding: '12px 18px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              autoFocus
              placeholder="Search icons — e.g. grocery, clothing, home"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 32px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 12.5, outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ padding: '4px 14px 18px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {filtered.map(({ name, Icon }) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onPick(lucideIconToFile(Icon, name))}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '10px 4px', borderRadius: 10, border: '1.5px solid #e2e8f0',
                background: '#f8fafc', cursor: 'pointer', color: '#0f172a',
              }}
            >
              <Icon size={20} strokeWidth={1.75} />
              <span style={{ fontSize: 8.5, fontWeight: 700, color: '#64748b', textAlign: 'center', lineHeight: 1.2 }}>{name}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <span style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '20px 0' }}>
              No icons match "{q}".
            </span>
          )}
        </div>
      </div>
    </ModalPortal>
  );
};

/**
 * Icon / custom-image picker for a Level-1 header — shared by the Add and
 * Edit modals so they can never drift apart the way they did before (Add
 * had a decorative version of this section, Edit had none at all).
 *
 * A freshly-chosen file always wins the preview over whatever's already
 * saved; `existingUrl` only matters until the admin picks something new.
 */
const HeaderMediaPicker = ({
  iconFile, imageFile, existingIconUrl, existingImageUrl,
  onIconPick, onImagePick, imageInputRef,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const iconPreview = iconFile ? URL.createObjectURL(iconFile) : existingIconUrl;
  const imagePreview = imageFile ? URL.createObjectURL(imageFile) : existingImageUrl;

  const circleStyle = (dashed) => ({
    width: 80, height: 80, borderRadius: '50%',
    backgroundColor: '#f8fafc',
    border: dashed ? '2px dashed #cbd5e1' : '1.5px solid #cbd5e1',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, width: '100%' }}>

        {/* Select Icon card */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={circleStyle(false)} onClick={() => setPickerOpen(true)}>
            {iconPreview
              ? <img src={iconPreview} alt="Icon preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 32, color: '#0f172a' }}>✨</span>}
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              backgroundColor: '#000000', color: '#ffffff', border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
            }}
          >
            Select Icon
          </button>
          {pickerOpen && (
            <IconPickerModal
              onClose={() => setPickerOpen(false)}
              onPick={(file) => { onIconPick(file); setPickerOpen(false); }}
            />
          )}
        </div>

        <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>OR</span>

        {/* Custom Image Card */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={circleStyle(true)} onClick={() => imageInputRef.current?.click()}>
            {imagePreview
              ? <img src={imagePreview} alt="Cover preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: 24, color: '#64748b' }}>📤</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', marginTop: 4 }}>Upload</span>
                </span>
              )}
          </div>
          <input
            ref={imageInputRef} type="file" accept="image/*" hidden
            onChange={(e) => onImagePick(e.target.files?.[0] || null)}
          />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>Custom Image</span>
        </div>

      </div>
      <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Choose an SVG icon or upload a custom image</span>
    </div>
  );
};

export const CategoriesTab = ({ subTab }) => {
  const ui = useFeedback();
  const { triggerToast } = useAdmin();
  
  // Search query states
  const [searchQuery, setSearchQuery] = useState('');
  const [headerFilter, setHeaderFilter] = useState('All');
  const [level2Filter, setLevel2Filter] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');

  // ==========================================================================
  // LIVE CATEGORY TREE — GET /api/categories/tree (3 levels).
  // Everything below derives from the database; nothing is hardcoded, and every
  // create/delete is persisted so it survives a refresh.
  // ==========================================================================
  const [tree, setTree] = useState([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [stats, setStats] = useState(null);

  // Customer-visible category trees are Shop All and Quick. Historical SHG
  // categories remain in storage for old records, but are not manageable here.
  const SECTIONS = [
    { key: 'ecommerce', label: 'Shop All', icon: '🛒' },
    { key: 'grocery', label: 'Quick', icon: '⚡' },
  ];

  const [channel, setChannel] = useState(() => {
    const saved = localStorage.getItem('adminCategoryChannel');
    return saved === 'grocery' || saved === 'ecommerce' ? saved : 'ecommerce';
  });

  const switchChannel = (next) => {
    if (!SECTIONS.some((section) => section.key === next)) return;
    setChannel(next);
    localStorage.setItem('adminCategoryChannel', next);   // survive a refresh
    setSelectedHeader('');
    setSelectedLevel2('');
    setHeaderFilter('All');
    setLevel2Filter('All');
    setSearchQuery('');
  };

  const loadTree = React.useCallback(async () => {
    setLoadingTree(true);
    setTreeError('');
    try {
      const [treeRes, statsRes] = await Promise.all([
        authGet(`/api/categories/tree?type=${channel}`),
        authGet('/api/categories/stats').catch(() => ({ data: null })),
      ]);
      setTree(Array.isArray(treeRes.data) ? treeRes.data : []);
      if (statsRes.data) setStats(statsRes.data);
    } catch (err) {
      setTreeError(err.message);
      setTree([]);
    } finally {
      setLoadingTree(false);
    }
  }, [channel]);

  React.useEffect(() => { loadTree(); }, [loadTree]);

  const sectionLabel = (SECTIONS.find((s) => s.key === channel) || SECTIONS[0]).label;

  // Flatten the tree into the three shapes this screen renders.
  const headerCategories = React.useMemo(
    () => tree.map((n) => ({
      id: n._id, name: n.name, slug: n.slug, type: n.type,
      status: n.isActive ? 'active' : 'inactive',
      isPopular: n.isPopular || false,
      showOnHome: n.showOnHome || false,
      showInNav: n.showInNav || false,
      isSystem: n.isSystem || false,
      backgroundColor: n.backgroundColor || '',
      textColor: n.textColor || '',
      activeTabColor: n.activeTabColor || '',
      icon: n.icon || '',
      image: n.image || '',
    })),
    [tree]
  );

  const mainCategories = React.useMemo(
    () => tree.flatMap((l1) =>
      (l1.children || []).map((l2) => ({
        id: l2._id, name: l2.name, parent: l1.name, parentId: l1._id,
        slug: l2.slug, type: l2.type,
        status: l2.isActive ? 'active' : 'inactive',
        isPopular: l2.isPopular || false,
        showOnHome: l2.showOnHome || false,
        icon: l2.icon || '',
        image: l2.image || '',
      }))
    ),
    [tree]
  );

  const subCategories = React.useMemo(
    () => tree.flatMap((l1) =>
      (l1.children || []).flatMap((l2) =>
        (l2.children || []).map((l3) => ({
          id: l3._id, name: l3.name,
          parentL1: l1.name, parentL2: l2.name, parentId: l2._id,
          slug: l3.slug, type: l3.type,
          status: l3.isActive ? 'active' : 'inactive',
          isPopular: l3.isPopular || false,
          showOnHome: l3.showOnHome || false,
          icon: l3.icon || '',
          image: l3.image || '',
        }))
      )
    ),
    [tree]
  );

  // Explorer columns, derived from the live tree instead of fixed lookup tables.
  const level2Map = React.useMemo(() => {
    const m = {};
    tree.forEach((l1) => { m[l1.name] = (l1.children || []).map((c) => c.name); });
    return m;
  }, [tree]);

  const subcategoryMap = React.useMemo(() => {
    const m = {};
    tree.forEach((l1) => (l1.children || []).forEach((l2) => {
      m[l2.name] = (l2.children || []).map((c) => c.name);
    }));
    return m;
  }, [tree]);

  // State for Column selections (Explorer Tab)
  const [selectedHeader, setSelectedHeader] = useState('');
  const [selectedLevel2, setSelectedLevel2] = useState('');

  // State for Modals
  const [showAddHeaderModal, setShowAddHeaderModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [showAddSubcategoryModal, setShowAddSubcategoryModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);

  // New Header form values (Level 1)
  const [newHeader, setNewHeader] = useState({
    name: '',
    slug: '',
    bg: '#FF1E1E',
    textColor: '#111111',
    iconColor: '#111111',
    status: 'Active',
    type: 'ecommerce',
    isPopular: false,
    showOnHome: false,
    showInNav: false,
  });

  // New Category form values (Level 2)
  const [newCategory, setNewCategory] = useState({
    name: '',
    slug: '',
    parentHeader: '',
    status: 'Active',
    isPopular: false,
    showOnHome: false,
  });

  // New Subcategory form values (Level 3)
  const [newSubcategory, setNewSubcategory] = useState({
    name: '',
    slug: '',
    parentL2: '',
    status: 'Active',
    isPopular: false,
    showOnHome: false,
  });

  // Edit Category form values
  const [editForm, setEditForm] = useState({
    name: '',
    slug: '',
    parent: '',
    bg: '#ffffff',
    textColor: '#000000',
    iconColor: '#000000',
    isPopular: false,
    showOnHome: false,
    showInNav: false,
    isSystem: false,
  });

  /**
   * Icon/custom-image files for a Level-1 header, kept out of `newHeader`/
   * `editForm` since a File can't round-trip through JSON.stringify the way
   * the rest of those fields do — only these two get FormData treatment on
   * submit, everything else stays on the plain-JSON path unchanged.
   *
   * `*Existing` holds the currently-saved Cloudinary URL so Edit can preview
   * what's already there (Add never has one); a freshly chosen File always
   * takes priority for the preview, but the URL is what's re-sent if the
   * admin doesn't touch that picker at all.
   */
  const [headerIconFile, setHeaderIconFile] = useState(null);
  const [headerImageFile, setHeaderImageFile] = useState(null);
  const [editIconFile, setEditIconFile] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editIconExisting, setEditIconExisting] = useState('');
  const [editImageExisting, setEditImageExisting] = useState('');

  const addImageInputRef = React.useRef(null);
  const editImageInputRef = React.useRef(null);

  const handleHeaderClick = (name) => {
    setSelectedHeader(name);
    setSelectedLevel2(''); // Reset level 2 and sub
  };

  const handleLevel2Click = (name) => {
    setSelectedLevel2(name);
  };

  // ==========================================================================
  // CREATE — all three levels persist via POST /api/categories.
  // Level is expressed purely by `parent`: null = header, L1 = main, L2 = sub.
  // ==========================================================================

  const handleAddHeaderSubmit = async (e) => {
    e.preventDefault();
    if (!newHeader.name.trim()) return;

    try {
      const fields = {
        name: newHeader.name.trim(),
        type: channel,   // stamped from the active section — Shop All or Quick
        parent: '',                      // empty => Level 1 (header)
        sortOrder: headerCategories.length + 1,
        backgroundColor: newHeader.bg,
        textColor: newHeader.textColor,
        activeTabColor: newHeader.iconColor,
        isPopular: newHeader.isPopular,
        showOnHome: newHeader.showOnHome,
        showInNav: newHeader.showInNav,
      };

      // Only pay the FormData/multipart cost when a file was actually
      // chosen — every other field keeps going through plain JSON, same as
      // before this feature existed.
      if (headerIconFile || headerImageFile) {
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        if (headerIconFile) fd.append('icon', headerIconFile);
        if (headerImageFile) fd.append('image', headerImageFile);
        await authPost('/api/categories', fd);
      } else {
        await authPost('/api/categories', fields);
      }

      triggerToast(`Header category "${newHeader.name}" created.`);
      await loadTree();
      setNewHeader({
        name: '', slug: '', bg: '#FF1E1E', textColor: '#111111', iconColor: '#111111',
        status: 'Active', type: channel,
        isPopular: false, showOnHome: false, showInNav: false,
      });
      setHeaderIconFile(null);
      setHeaderImageFile(null);
      setShowAddHeaderModal(false);
    } catch (err) {
      triggerToast(err.message, {type:'error'});
    }
  };

  const handleAddCategorySubmit = async (e) => {
    e.preventDefault();
    if (!newCategory.name.trim() || !newCategory.parentHeader) {
      triggerToast('Please select a parent header and enter a category name.');
      return;
    }

    const parent = headerCategories.find((h) => h.name === newCategory.parentHeader);
    if (!parent) { triggerToast('Parent header not found.'); return; }

    try {
      await authPost('/api/categories', {
        name: newCategory.name.trim(),
        type: parent.type,          // a child always lives in its parent's channel
        parent: parent.id,          // => Level 2 (main)
        sortOrder: mainCategories.filter((m) => m.parentId === parent.id).length + 1,
        isPopular: newCategory.isPopular,
        showOnHome: newCategory.showOnHome,
      });
      triggerToast(`"${newCategory.name}" created under "${parent.name}".`);
      await loadTree();
      setNewCategory({ name: '', slug: '', parentHeader: '', status: 'Active', isPopular: false, showOnHome: false });
      setShowAddCategoryModal(false);
    } catch (err) {
      triggerToast(err.message, {type:'error'});
    }
  };

  const handleAddSubcategorySubmit = async (e) => {
    e.preventDefault();
    if (!newSubcategory.name.trim() || !newSubcategory.parentL2) {
      triggerToast('Please select a parent category and enter a subcategory name.');
      return;
    }

    const parent = mainCategories.find((m) => m.name === newSubcategory.parentL2);
    if (!parent) { triggerToast('Parent category not found.'); return; }

    try {
      await authPost('/api/categories', {
        name: newSubcategory.name.trim(),
        type: parent.type,
        parent: parent.id,          // => Level 3 (sub)
        sortOrder: subCategories.filter((sc) => sc.parentId === parent.id).length + 1,
        isPopular: newSubcategory.isPopular,
        showOnHome: newSubcategory.showOnHome,
      });
      triggerToast(`Subcategory "${newSubcategory.name}" created under "${parent.name}".`);
      await loadTree();
      setNewSubcategory({ name: '', slug: '', parentL2: '', status: 'Active', isPopular: false, showOnHome: false });
      setShowAddSubcategoryModal(false);
    } catch (err) {
      triggerToast(err.message, {type:'error'});
    }
  };

  const handleEditClick = (category, level) => {
    setEditingCategory({ ...category, level });
    setEditForm({
      name: category.name,
      slug: category.slug || '',
      parent: category.parentId || '',
      bg: category.backgroundColor || '#ffffff',
      textColor: category.textColor || '#000000',
      iconColor: category.activeTabColor || '#000000',
      isPopular: category.isPopular || false,
      showOnHome: category.showOnHome || false,
      showInNav: category.showInNav || false,
      isSystem: category.isSystem || false,
    });
    setEditIconFile(null);
    setEditImageFile(null);
    setEditIconExisting(category.icon || '');
    setEditImageExisting(category.image || '');
    setShowEditModal(true);
  };

  const handleEditCategorySubmit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) return;

    try {
      const payload = {
        name: editForm.name.trim(),
        slug: editForm.slug.trim() || undefined,
        isPopular: editForm.isPopular,
        showOnHome: editForm.showOnHome,
        showInNav: editForm.showInNav,
      };

      if (editingCategory.level === 1) {
        payload.backgroundColor = editForm.bg;
        payload.textColor = editForm.textColor;
        payload.activeTabColor = editForm.iconColor;
      } else if (editForm.parent) {
        // If parent ID is a name, find the category object
        const resolvedParent = editingCategory.level === 2
          ? headerCategories.find(h => h.id === editForm.parent || h.name === editForm.parent)
          : mainCategories.find(m => m.id === editForm.parent || m.name === editForm.parent);
        if (resolvedParent) {
          payload.parent = resolvedParent.id;
        }
      }

      if (editingCategory.level === 1 && (editIconFile || editImageFile)) {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => { if (v !== undefined) fd.append(k, v); });
        if (editIconFile) fd.append('icon', editIconFile);
        if (editImageFile) fd.append('image', editImageFile);
        await authPut(`/api/categories/${editingCategory.id}`, fd);
      } else {
        await authPut(`/api/categories/${editingCategory.id}`, payload);
      }

      triggerToast(`Category "${editForm.name}" updated successfully.`);
      await loadTree();
      setShowEditModal(false);
      setEditingCategory(null);
      setEditIconFile(null);
      setEditImageFile(null);
    } catch (err) {
      triggerToast(err.message, {type:'error'});
    }
  };

  // ==========================================================================
  // DELETE — DELETE /api/categories/:id (server soft-deletes: isActive = false,
  // so products already pointing at the category are not orphaned).
  // ==========================================================================
  const removeCategory = async (id, name, label) => {
    return ui.perform(`Delete ${label} "${name}"?`, async () => {
    try {
      await authDelete(`/api/categories/${id}`);
      triggerToast(`${label} "${name}" deleted.`);
      await loadTree();
    } catch (err) {
      triggerToast(err.message, {type:'error'});
    }

});
};

  const handleDeleteHeader = (id, name) => removeCategory(id, name, 'Header category');
  const handleDeleteCategory = (id, name) => removeCategory(id, name, 'Category');
  const handleDeleteSubcategory = (id, name) => removeCategory(id, name, 'Subcategory');


  return (
    <div style={{ padding: '24px', boxSizing: 'border-box' }}>

      {/* ── SECTION SWITCH: supported customer category trees ──────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {SECTIONS.map((sec) => {
          const active = channel === sec.key;
          const count = stats && stats[sec.key] ? stats[sec.key].total : null;
          return (
            <button
              key={sec.key}
              onClick={() => switchChannel(sec.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 18px', borderRadius: 12, cursor: 'pointer',
                fontSize: 13, fontWeight: 800,
                border: active ? '2px solid var(--admin-primary, #10b981)' : '1.5px solid var(--admin-border-color, #e2e8f0)',
                background: active ? 'var(--admin-primary, #10b981)' : 'transparent',
                color: active ? '#062e24' : 'inherit',
                transition: 'all 0.15s ease-in-out',
              }}
            >
              <span style={{ fontSize: 15 }}>{sec.icon}</span>
              <span>{sec.label} Category</span>
              {count !== null && (
                <span style={{
                  fontSize: 10, fontWeight: 900, padding: '2px 7px', borderRadius: 20,
                  background: active ? 'rgba(0,0,0,0.18)' : 'var(--admin-border-color, #e2e8f0)',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 4 }}>
          Managing the <strong>{sectionLabel}</strong> catalogue
        </span>
      </div>

      {/* Quick starts empty until it is configured */}
      {!loadingTree && !treeError && tree.length === 0 && (
        <div style={{
          padding: '36px 20px', textAlign: 'center', borderRadius: 14, marginBottom: 20,
          border: '1.5px dashed var(--admin-border-color, #e2e8f0)',
          background: 'var(--admin-bg-sidebar, rgba(148,163,184,0.06))',
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>
            {(SECTIONS.find((s) => s.key === channel) || SECTIONS[0]).icon}
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
            No {sectionLabel} categories yet
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
            Add a header category to start building the {sectionLabel} catalogue.
            <br />Header → Main → Sub, up to three levels.
          </div>
        </div>
      )}
      
      {/* ── 1. ALL CATEGORIES / HIERARCHY EXPLORER ──────────────────── */}
      {subTab === 'categories-all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Top Panel Hero Bar */}
          <div style={{ 
            backgroundColor: '#ffffff', 
            border: '1px solid #e2e8f0', 
            borderRadius: 16, 
            padding: '20px 24px', 
            boxShadow: '0 1px 3px rgba(0,0,0,0.01)', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center' 
          }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📂</span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Category Hierarchy Explorer</h3>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>
                Visual overview of your catalog structure ({headerCategories.length + mainCategories.length + subCategories.length} items)
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Top Right Metrics Panel */}
              <div style={{
                backgroundColor: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: 24,
                padding: '6px 20px',
                display: 'flex',
                gap: 16,
                fontSize: 12,
                fontWeight: 700,
                color: '#475569'
              }}>
                <span>Headers: <strong style={{ color: '#0f172a' }}>{headerCategories.length}</strong></span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#8b5cf6' }} />
                  Level 2: <strong style={{ color: '#0f172a' }}>{mainCategories.length}</strong>
                </span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span>Subcategories: <strong style={{ color: '#0f172a' }}>{subCategories.length}</strong></span>
              </div>
            </div>
          </div>

          {/* 3-Column Panel Explorer grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, minHeight: '480px' }}>
            
            {/* Column 1: Header Categories */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>📁</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>Header Categories</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, backgroundColor: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 10 }}>40</span>
              </div>

              {/* Search Category */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                backgroundColor: '#f8fafc', 
                border: '1.5px solid #e2e8f0', 
                borderRadius: 8, 
                padding: '6px 12px', 
                marginBottom: 12 
              }}>
                <span style={{ fontSize: 12 }}>🔍</span>
                <input 
                  type="text" 
                  placeholder="Search category"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12, width: '100%', fontWeight: 600 }}
                />
              </div>

              {/* Scrollable list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, maxHeight: '380px' }}>
                {headerCategories
                  .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(c => {
                    const isSelected = selectedHeader === c.name;
                    return (
                      <button
                        key={c.id}
                        onClick={() => handleHeaderClick(c.name)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          border: '1.5px solid',
                          borderColor: isSelected ? 'var(--sa-primary)' : '#f1f5f9',
                          borderRadius: 12,
                          backgroundColor: isSelected ? 'var(--sa-primary-glow)' : '#ffffff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <span style={{ fontSize: 16 }}>📁</span>
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{c.slug}</span>
                          </div>
                        </div>
                        <span style={{ color: isSelected ? 'var(--sa-primary)' : '#94a3b8', fontSize: 12 }}>❯</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Column 2: Level 2 Categories */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>📂</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>Level 2 Categories</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, backgroundColor: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 10 }}>
                  {selectedHeader ? (level2Map[selectedHeader] || []).length : 0}
                </span>
              </div>

              {!selectedHeader ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', padding: 20 }}>
                  <span style={{ fontSize: 32, marginBottom: 12 }}>➡️</span>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
                    Select a Header Category<br />to view its contents
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, maxHeight: '420px' }}>
                  {(level2Map[selectedHeader] || []).map(lvl2 => {
                    const isSelected = selectedLevel2 === lvl2;
                    return (
                      <button
                        key={lvl2}
                        onClick={() => handleLevel2Click(lvl2)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          border: '1.5px solid',
                          borderColor: isSelected ? '#8b5cf6' : '#f1f5f9',
                          borderRadius: 12,
                          backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.05)' : '#ffffff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 16 }}>📂</span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{lvl2}</span>
                        </div>
                        <span style={{ color: isSelected ? '#8b5cf6' : '#94a3b8', fontSize: 12 }}>❯</span>
                      </button>
                    );
                  })}
                  {(level2Map[selectedHeader] || []).length === 0 && (
                    <span style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 20 }}>No Level 2 categories found.</span>
                  )}
                </div>
              )}
            </div>

            {/* Column 3: Subcategories */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🏷️</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>Subcategories</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, backgroundColor: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 10 }}>
                  {selectedLevel2 ? (subcategoryMap[selectedLevel2] || []).length : 0}
                </span>
              </div>

              {!selectedLevel2 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', padding: 20 }}>
                  <span style={{ fontSize: 32, marginBottom: 12 }}>➡️</span>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
                    Select a Level 2 Category<br />to view subcategories
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, maxHeight: '420px' }}>
                  {(subcategoryMap[selectedLevel2] || []).map(sub => (
                    <div
                      key={sub}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        border: '1.5px solid #f1f5f9',
                        borderRadius: 12,
                        backgroundColor: '#ffffff'
                      }}
                    >
                      <span style={{ fontSize: 16 }}>🏷️</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{sub}</span>
                    </div>
                  ))}
                  {(subcategoryMap[selectedLevel2] || []).length === 0 && (
                    <span style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 20 }}>No leaf subcategories found.</span>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── 2. HEADER CATEGORIES VIEW ──────────────────────────────── */}
      {subTab === 'categories-header' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Header Title Section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'left' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Header Categories</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                Manage top-level categories
              </p>
            </div>
            
            {/* Add New Header Action Button */}
            <button
              onClick={() => setShowAddHeaderModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#000000',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              <span style={{ fontSize: 14 }}>+</span> Add New Header
            </button>
          </div>

          {/* Search Header Bar */}
          <div style={{ 
            backgroundColor: '#ffffff', 
            border: '1.5px solid #f1f5f9', 
            borderRadius: 12, 
            padding: '12px 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 10,
            boxShadow: '0 1px 2px rgba(0,0,0,0.01)'
          }}>
            <span style={{ fontSize: 14, color: '#94a3b8' }}>🔍</span>
            <input 
              type="text" 
              placeholder="Search header categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ border: 'none', background: 'none', outline: 'none', width: '100%', fontSize: 13, fontWeight: 600, color: '#0f172a' }}
            />
          </div>

          {/* Table list */}
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '16px 20px', width: 40 }}>
                    <input type="checkbox" style={{ accentColor: '#0f172a' }} />
                  </th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Image</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Slug</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {headerCategories
                  .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#0f172a' }}>
                      <td style={{ padding: '14px 20px' }}>
                        <input type="checkbox" style={{ accentColor: '#0f172a' }} />
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          backgroundColor: '#f1f5f9', 
                          border: '1px solid #e2e8f0', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          color: '#94a3b8',
                          fontSize: 16,
                          overflow: 'hidden'
                        }}>
                          {c.image || c.icon ? (
                            <img src={c.image || c.icon} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                          ) : (
                            '🖼️'
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 20px', fontWeight: 700 }}>{c.name}</td>
                      <td style={{ padding: '14px 20px', color: '#64748b', fontFamily: 'monospace' }}>{c.slug}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 800,
                          backgroundColor: 'rgba(139, 92, 246, 0.1)',
                          color: '#8b5cf6',
                          padding: '3px 8px',
                          borderRadius: 20,
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px'
                        }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                          <button
                            onClick={() => handleEditClick(c, 1)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#64748b' }}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          {!c.isSystem && (
                            <button
                              onClick={() => handleDeleteHeader(c.id, c.name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#dc2626' }}
                              title="Delete"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ── 3. MAIN CATEGORIES (LEVEL 2) VIEW ────────────────────────── */}
      {subTab === 'categories-main' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Header Title Section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'left' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Level 2 Categories</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                Manage secondary categories linked to headers
              </p>
            </div>
            
            {/* Add New Category Action Button */}
            <button
              onClick={() => setShowAddCategoryModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#000000',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              <span style={{ fontSize: 14 }}>+</span> Add New Category
            </button>
          </div>

          {/* Search, Filter & Sort Row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            
            {/* Search Input */}
            <div style={{ 
              backgroundColor: '#ffffff', 
              border: '1.5px solid #f1f5f9', 
              borderRadius: 12, 
              padding: '10px 16px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              boxShadow: '0 1px 2px rgba(0,0,0,0.01)',
              flex: 2,
              minWidth: '240px'
            }}>
              <span style={{ fontSize: 14, color: '#94a3b8' }}>🔍</span>
              <input 
                type="text" 
                placeholder="Search categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: 'none', background: 'none', outline: 'none', width: '100%', fontSize: 13, fontWeight: 600, color: '#0f172a' }}
              />
            </div>

            {/* Filter symbol indicator */}
            <div style={{ 
              width: 40, 
              height: 40, 
              borderRadius: 12, 
              border: '1.5px solid #cbd5e1', 
              backgroundColor: '#fff', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              color: '#475569', 
              fontSize: 14,
              fontWeight: 800
            }}>
              ⏳
            </div>

            {/* Header Parent Filter dropdown */}
            <select
              value={headerFilter}
              onChange={(e) => setHeaderFilter(e.target.value)}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: '1.5px solid #cbd5e1',
                backgroundColor: '#fff',
                fontSize: 12.5,
                fontWeight: 700,
                color: '#475569',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '180px',
                flex: 1
              }}
            >
              <option value="All">All Header Categories</option>
              {headerCategories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: '1.5px solid #cbd5e1',
                backgroundColor: '#fff',
                fontSize: 12.5,
                fontWeight: 700,
                color: '#475569',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '130px',
                flex: 0.8
              }}
            >
              <option value="Newest">Newest first</option>
              <option value="Oldest">Oldest first</option>
            </select>

          </div>

          {/* Table list grid */}
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '16px 20px', width: 40 }}>
                    <input type="checkbox" style={{ accentColor: '#0f172a' }} />
                  </th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Image</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Parent Header</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Slug</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mainCategories
                  .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .filter(c => headerFilter === 'All' ? true : c.parent === headerFilter)
                  .map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#0f172a' }}>
                      <td style={{ padding: '14px 20px' }}>
                        <input type="checkbox" style={{ accentColor: '#0f172a' }} />
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          backgroundColor: '#f1f5f9', 
                          border: '1px solid #e2e8f0', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          color: '#94a3b8',
                          fontSize: 16,
                          overflow: 'hidden'
                        }}>
                          {c.image || c.icon ? (
                            <img src={c.image || c.icon} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                          ) : (
                            '🖼️'
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 20px', fontWeight: 700 }}>{c.name}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ 
                          fontSize: 10, 
                          fontWeight: 700, 
                          backgroundColor: '#f1f5f9', 
                          color: '#475569', 
                          padding: '3px 8px', 
                          borderRadius: 6
                        }}>
                          {c.parent}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', color: '#64748b', fontFamily: 'monospace' }}>{c.slug}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ 
                          fontSize: 10, 
                          fontWeight: 800, 
                          backgroundColor: 'rgba(139, 92, 246, 0.1)', 
                          color: '#8b5cf6', 
                          padding: '3px 8px', 
                          borderRadius: 20, 
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px'
                        }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                          <button 
                            onClick={() => handleEditClick(c, 2)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#64748b' }}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          {!c.isSystem && (
                            <button 
                              onClick={() => handleDeleteCategory(c.id, c.name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#dc2626' }}
                              title="Delete"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ── 4. SUB-CATEGORIES (LEVEL 3) VIEW (New Image 1) ────────── */}
      {subTab === 'categories-sub' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Header Title Section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'left' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Subcategories</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                Manage level 3 categories linked to secondary categories
              </p>
            </div>
            
            {/* Add New Subcategory Action Button */}
            <button
              onClick={() => setShowAddSubcategoryModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#000000',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              <span style={{ fontSize: 14 }}>+</span> Add New Subcategory
            </button>
          </div>

          {/* Search, Filter & Sort Row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            
            {/* Search Input */}
            <div style={{ 
              backgroundColor: '#ffffff', 
              border: '1.5px solid #f1f5f9', 
              borderRadius: 12, 
              padding: '10px 16px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              boxShadow: '0 1px 2px rgba(0,0,0,0.01)',
              flex: 2,
              minWidth: '240px'
            }}>
              <span style={{ fontSize: 14, color: '#94a3b8' }}>🔍</span>
              <input 
                type="text" 
                placeholder="Search subcategories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: 'none', background: 'none', outline: 'none', width: '100%', fontSize: 13, fontWeight: 600, color: '#0f172a' }}
              />
            </div>

            {/* Filter symbol indicator */}
            <div style={{ 
              width: 40, 
              height: 40, 
              borderRadius: 12, 
              border: '1.5px solid #cbd5e1', 
              backgroundColor: '#fff', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              color: '#475569', 
              fontSize: 14,
              fontWeight: 800
            }}>
              ⏳
            </div>

            {/* Level 2 Parent Filter dropdown */}
            <select
              value={level2Filter}
              onChange={(e) => setLevel2Filter(e.target.value)}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: '1.5px solid #cbd5e1',
                backgroundColor: '#fff',
                fontSize: 12.5,
                fontWeight: 700,
                color: '#475569',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '180px',
                flex: 1
              }}
            >
              <option value="All">All Level 2 Categories</option>
              {mainCategories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: '1.5px solid #cbd5e1',
                backgroundColor: '#fff',
                fontSize: 12.5,
                fontWeight: 700,
                color: '#475569',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '130px',
                flex: 0.8
              }}
            >
              <option value="Newest">Newest first</option>
              <option value="Oldest">Oldest first</option>
            </select>

          </div>

          {/* Table list grid */}
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '16px 20px', width: 40 }}>
                    <input type="checkbox" style={{ accentColor: '#0f172a' }} />
                  </th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Image</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Parent Chain</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Slug</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subCategories
                  .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .filter(c => level2Filter === 'All' ? true : c.parentL2 === level2Filter)
                  .map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#0f172a' }}>
                      <td style={{ padding: '14px 20px' }}>
                        <input type="checkbox" style={{ accentColor: '#0f172a' }} />
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          backgroundColor: '#f1f5f9', 
                          border: '1px solid #e2e8f0', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          color: '#94a3b8',
                          fontSize: 16,
                          overflow: 'hidden'
                        }}>
                          {c.image || c.icon ? (
                            <img src={c.image || c.icon} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                          ) : (
                            '🖼️'
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 20px', fontWeight: 700 }}>{c.name}</td>
                      <td style={{ padding: '14px 20px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 700 }}>• {c.parentL1}</span>
                          <span style={{ fontSize: 12, color: '#334155', fontWeight: 800 }}>{c.parentL2}</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 20px', color: '#64748b', fontFamily: 'monospace' }}>{c.slug}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ 
                          fontSize: 10, 
                          fontWeight: 800, 
                          backgroundColor: 'rgba(139, 92, 246, 0.1)', 
                          color: '#8b5cf6', 
                          padding: '3px 8px', 
                          borderRadius: 20, 
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px'
                        }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                          <button 
                            onClick={() => handleEditClick(c, 3)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#64748b' }}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          {!c.isSystem && (
                            <button 
                              onClick={() => handleDeleteSubcategory(c.id, c.name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#dc2626' }}
                              title="Delete"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ── 5. ADD HEADER CATEGORY OVERLAY SHEET (Level 1 Modal) ──── */}
      {showAddHeaderModal && (
        <ModalPortal style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000,
        }}>
          
          <div style={{
            width: '100%',
            maxWidth: '520px',
            height: '100%',
            backgroundColor: '#ffffff',
            boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box'
          }}>
            
            {/* Modal Header */}
            <div style={{ 
              padding: '20px 24px', 
              borderBottom: '1px solid #e2e8f0', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              boxSizing: 'border-box'
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Add Header Category</h3>
              <button
                onClick={() => { setShowAddHeaderModal(false); setHeaderIconFile(null); setHeaderImageFile(null); }}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body Scroll Container */}
            <form 
              onSubmit={handleAddHeaderSubmit}
              style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'left', boxSizing: 'border-box' }}
            >
              
              {/* Icon / Image selector section */}
              <HeaderMediaPicker
                iconFile={headerIconFile}
                imageFile={headerImageFile}
                existingIconUrl=""
                existingImageUrl=""
                onIconPick={setHeaderIconFile}
                onImagePick={setHeaderImageFile}
                imageInputRef={addImageInputRef}
              />

              {/* Color pickers grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                
                {/* Header Background */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Header Background</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input 
                      type="color" 
                      value={newHeader.bg}
                      onChange={(e) => setNewHeader(prev => ({ ...prev, bg: e.target.value }))}
                      style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer' }}
                    />
                    <input 
                      type="text" 
                      value={newHeader.bg.toUpperCase()}
                      onChange={(e) => setNewHeader(prev => ({ ...prev, bg: e.target.value }))}
                      style={{ flex: 1, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}
                    />
                  </div>
                </div>

                {/* Title/Text Color */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Title/Text Color</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input 
                      type="color" 
                      value={newHeader.textColor}
                      onChange={(e) => setNewHeader(prev => ({ ...prev, textColor: e.target.value }))}
                      style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer' }}
                    />
                    <input 
                      type="text" 
                      value={newHeader.textColor.toUpperCase()}
                      onChange={(e) => setNewHeader(prev => ({ ...prev, textColor: e.target.value }))}
                      style={{ flex: 1, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}
                    />
                  </div>
                </div>

              </div>

              {/* Active Tab / Icon Color */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '50%' }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Active Tab / Icon Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input 
                    type="color" 
                    value={newHeader.iconColor}
                    onChange={(e) => setNewHeader(prev => ({ ...prev, iconColor: e.target.value }))}
                    style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer' }}
                  />
                  <input 
                    type="text" 
                    value={newHeader.iconColor.toUpperCase()}
                    onChange={(e) => setNewHeader(prev => ({ ...prev, iconColor: e.target.value }))}
                    style={{ flex: 1, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}
                  />
                </div>
              </div>

              {/* Input Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                
                {/* Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Name</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g., Electronics"
                    value={newHeader.name}
                    onChange={(e) => setNewHeader(prev => ({ ...prev, name: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none' }}
                  />
                </div>

                {/* Slug */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Slug</label>
                  <input 
                    type="text"
                    placeholder="e.g., electronics"
                    value={newHeader.slug}
                    onChange={(e) => setNewHeader(prev => ({ ...prev, slug: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none' }}
                  />
                </div>

                {/* Status selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Status</label>
                  <select 
                    value={newHeader.status}
                    onChange={(e) => setNewHeader(prev => ({ ...prev, status: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer', backgroundColor: '#fff' }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                {/* Show in the customer's header */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    Customer Navigation
                  </label>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, backgroundColor: '#fff',
                  }}>
                    <input
                      type="checkbox"
                      checked={newHeader.showInNav}
                      onChange={(e) => setNewHeader(prev => ({ ...prev, showInNav: e.target.checked }))}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>
                      Show as a tab in the app header
                    </span>
                  </label>
                  <span style={{ fontSize: 10.5, color: '#64748b' }}>
                    Only ticked categories appear in the customer's top navigation.
                  </span>
                </div>

                  {/* Homepage Placement checkboxes */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={newHeader.isPopular}
                        onChange={(e) => setNewHeader(prev => ({ ...prev, isPopular: e.target.checked }))}
                        style={{ accentColor: '#10b981', width: 16, height: 16 }}
                      />
                      Feature in "Popular Categories"
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={newHeader.showOnHome}
                        onChange={(e) => setNewHeader(prev => ({ ...prev, showOnHome: e.target.checked }))}
                        style={{ accentColor: '#10b981', width: 16, height: 16 }}
                      />
                      Show on Homepage Section Grid
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={newHeader.showInNav}
                        onChange={(e) => setNewHeader(prev => ({ ...prev, showInNav: e.target.checked }))}
                        style={{ accentColor: '#10b981', width: 16, height: 16 }}
                      />
                      Show in Sub-Navigation Bar
                    </label>
                  </div>

                </div>

              {/* Form Footer Actions */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                alignItems: 'center', 
                gap: 16, 
                marginTop: 24, 
                paddingTop: 16, 
                borderTop: '1px solid #e2e8f0', 
                boxSizing: 'border-box' 
              }}>
                <button 
                  type="button"
                  onClick={() => setShowAddHeaderModal(false)}
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{
                    backgroundColor: '#000000',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 20px',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Create Header
                </button>
              </div>

            </form>

          </div>
        </ModalPortal>
      )}

      {/* ── 6. ADD CATEGORY OVERLAY SHEET (Level 2 Modal) ─────────── */}
      {showAddCategoryModal && (
        <ModalPortal style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000,
        }}>
          
          <div style={{
            width: '100%',
            maxWidth: '520px',
            height: '100%',
            backgroundColor: '#ffffff',
            boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box'
          }}>
            
            {/* Modal Header */}
            <div style={{ 
              padding: '20px 24px', 
              borderBottom: '1px solid #e2e8f0', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              boxSizing: 'border-box'
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Add Category</h3>
              <button 
                onClick={() => setShowAddCategoryModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body Scroll Container */}
            <form 
              onSubmit={handleAddCategorySubmit}
              style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'left', boxSizing: 'border-box' }}
            >
              
              {/* Image upload selector zone */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{
                  width: 88,
                  height: 88,
                  borderRadius: '50%',
                  border: '2px dashed #cbd5e1',
                  backgroundColor: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }} onClick={() => triggerToast('Select category logo to upload.')}>
                  <span style={{ fontSize: 24, color: '#94a3b8' }}>🖼️</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginTop: 4 }}>Upload</span>
                </div>
              </div>

              {/* Input Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                
                {/* Parent Header Category dropdown selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Parent Header Category</label>
                  <select 
                    required
                    value={newCategory.parentHeader}
                    onChange={(e) => setNewCategory(prev => ({ ...prev, parentHeader: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer', backgroundColor: '#fff' }}
                  >
                    <option value="">Select Parent Header Category</option>
                    {headerCategories.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Name</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g., Laptops"
                    value={newCategory.name}
                    onChange={(e) => setNewCategory(prev => ({ ...prev, name: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none' }}
                  />
                </div>

                {/* Slug */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Slug</label>
                  <input 
                    type="text"
                    placeholder="e.g., laptops"
                    value={newCategory.slug}
                    onChange={(e) => setNewCategory(prev => ({ ...prev, slug: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none' }}
                  />
                </div>

                {/* Status selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Status</label>
                  <select 
                    value={newCategory.status}
                    onChange={(e) => setNewCategory(prev => ({ ...prev, status: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer', backgroundColor: '#fff' }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                {/* Homepage Placement checkboxes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={newCategory.isPopular}
                      onChange={(e) => setNewCategory(prev => ({ ...prev, isPopular: e.target.checked }))}
                      style={{ accentColor: '#10b981', width: 16, height: 16 }}
                    />
                    Feature in "Popular Categories"
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={newCategory.showOnHome}
                      onChange={(e) => setNewCategory(prev => ({ ...prev, showOnHome: e.target.checked }))}
                      style={{ accentColor: '#10b981', width: 16, height: 16 }}
                    />
                    Show on Homepage Section Grid
                  </label>
                </div>

              </div>

              {/* Form Footer Actions */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                alignItems: 'center', 
                gap: 16, 
                marginTop: 24, 
                paddingTop: 16, 
                borderTop: '1px solid #e2e8f0', 
                boxSizing: 'border-box' 
              }}>
                <button 
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{
                    backgroundColor: '#000000',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 20px',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Create Category
                </button>
              </div>

            </form>

          </div>
        </ModalPortal>
      )}

      {/* ── 7. ADD SUB-CATEGORY OVERLAY SHEET (Level 3 Modal - Image 2) ─ */}
      {showAddSubcategoryModal && (
        <ModalPortal style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000,
        }}>
          
          <div style={{
            width: '100%',
            maxWidth: '520px',
            height: '100%',
            backgroundColor: '#ffffff',
            boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box'
          }}>
            
            {/* Modal Header */}
            <div style={{ 
              padding: '20px 24px', 
              borderBottom: '1px solid #e2e8f0', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              boxSizing: 'border-box'
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Add Subcategory</h3>
              <button 
                onClick={() => setShowAddSubcategoryModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body Scroll Container */}
            <form 
              onSubmit={handleAddSubcategorySubmit}
              style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'left', boxSizing: 'border-box' }}
            >
              
              {/* Image upload selector zone */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{
                  width: 88,
                  height: 88,
                  borderRadius: '50%',
                  border: '2px dashed #cbd5e1',
                  backgroundColor: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }} onClick={() => triggerToast('Select subcategory logo to upload.')}>
                  <span style={{ fontSize: 24, color: '#94a3b8' }}>🖼️</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginTop: 4 }}>Upload</span>
                </div>
              </div>

              {/* Input Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                
                {/* Parent Category (Level 2) dropdown selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Parent Category (Level 2)</label>
                  <select 
                    required
                    value={newSubcategory.parentL2}
                    onChange={(e) => setNewSubcategory(prev => ({ ...prev, parentL2: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer', backgroundColor: '#fff' }}
                  >
                    <option value="">Select Parent Category</option>
                    {mainCategories.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Name</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g., Gaming Laptops"
                    value={newSubcategory.name}
                    onChange={(e) => setNewSubcategory(prev => ({ ...prev, name: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none' }}
                  />
                </div>

                {/* Slug */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Slug</label>
                  <input 
                    type="text"
                    placeholder="e.g., gaming-laptops"
                    value={newSubcategory.slug}
                    onChange={(e) => setNewSubcategory(prev => ({ ...prev, slug: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none' }}
                  />
                </div>

                {/* Status selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Status</label>
                  <select 
                    value={newSubcategory.status}
                    onChange={(e) => setNewSubcategory(prev => ({ ...prev, status: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer', backgroundColor: '#fff' }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                {/* Homepage Placement checkboxes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={newSubcategory.isPopular}
                      onChange={(e) => setNewSubcategory(prev => ({ ...prev, isPopular: e.target.checked }))}
                      style={{ accentColor: '#10b981', width: 16, height: 16 }}
                    />
                    Feature in "Popular Categories"
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={newSubcategory.showOnHome}
                      onChange={(e) => setNewSubcategory(prev => ({ ...prev, showOnHome: e.target.checked }))}
                      style={{ accentColor: '#10b981', width: 16, height: 16 }}
                    />
                    Show on Homepage Section Grid
                  </label>
                </div>

              </div>

              {/* Form Footer Actions */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                alignItems: 'center', 
                gap: 16, 
                marginTop: 24, 
                paddingTop: 16, 
                borderTop: '1px solid #e2e8f0', 
                boxSizing: 'border-box' 
              }}>
                <button 
                  type="button"
                  onClick={() => setShowAddSubcategoryModal(false)}
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{
                    backgroundColor: '#000000',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 20px',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Create Subcategory
                </button>
              </div>

            </form>

          </div>
        </ModalPortal>
      )}

      {/* ── 8. EDIT CATEGORY OVERLAY SHEET (All Levels) ──────────────── */}
      {showEditModal && editingCategory && (
        <ModalPortal style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000,
        }}>
          
          <div style={{
            width: '100%',
            maxWidth: '520px',
            height: '100%',
            backgroundColor: '#ffffff',
            boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box'
          }}>
            
            {/* Modal Header */}
            <div style={{ 
              padding: '20px 24px', 
              borderBottom: '1px solid #e2e8f0', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              boxSizing: 'border-box'
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>
                Edit {editingCategory.level === 1 ? 'Header' : editingCategory.level === 2 ? 'Category' : 'Subcategory'} Details
              </h3>
              <button 
                onClick={() => { setShowEditModal(false); setEditingCategory(null); setEditIconFile(null); setEditImageFile(null); }}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body Scroll Container */}
            <form
              onSubmit={handleEditCategorySubmit}
              style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'left', boxSizing: 'border-box' }}
            >

              {/* Icon / Image selector — Level 1 headers only, mirrors Add */}
              {editingCategory.level === 1 && (
                <HeaderMediaPicker
                  iconFile={editIconFile}
                  imageFile={editImageFile}
                  existingIconUrl={editIconExisting}
                  existingImageUrl={editImageExisting}
                  onIconPick={setEditIconFile}
                  onImagePick={setEditImageFile}
                  imageInputRef={editImageInputRef}
                />
              )}

              {/* Input Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Parent Category selector (for Level 2 and Level 3) */}
                {editingCategory.level > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                      Parent {editingCategory.level === 2 ? 'Header' : 'Category (Level 2)'}
                    </label>
                    <select 
                      required
                      value={editForm.parent}
                      onChange={(e) => setEditForm(prev => ({ ...prev, parent: e.target.value }))}
                      style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer', backgroundColor: '#fff' }}
                    >
                      <option value="">Select Parent</option>
                      {editingCategory.level === 2 
                        ? headerCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                        : mainCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                      }
                    </select>
                  </div>
                )}

                {/* Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Name</label>
                  <input 
                    type="text"
                    required
                    disabled={editForm.isSystem}
                    value={editForm.name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none', backgroundColor: editForm.isSystem ? '#f1f5f9' : '#fff' }}
                  />
                </div>

                {/* Slug */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Slug</label>
                  <input 
                    type="text"
                    disabled={editForm.isSystem}
                    value={editForm.slug}
                    onChange={(e) => setEditForm(prev => ({ ...prev, slug: e.target.value }))}
                    style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 10, fontSize: 12.5, fontWeight: 600, outline: 'none', backgroundColor: editForm.isSystem ? '#f1f5f9' : '#fff' }}
                  />
                </div>

                {/* Color pickers (only for Level 1 Headers) */}
                {editingCategory.level === 1 && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Header Background</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input 
                            type="color" 
                            value={editForm.bg}
                            onChange={(e) => setEditForm(prev => ({ ...prev, bg: e.target.value }))}
                            style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer' }}
                          />
                          <input 
                            type="text" 
                            value={editForm.bg.toUpperCase()}
                            onChange={(e) => setEditForm(prev => ({ ...prev, bg: e.target.value }))}
                            style={{ flex: 1, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 12, fontWeight: 700 }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Title/Text Color</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input 
                            type="color" 
                            value={editForm.textColor}
                            onChange={(e) => setEditForm(prev => ({ ...prev, textColor: e.target.value }))}
                            style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer' }}
                          />
                          <input 
                            type="text" 
                            value={editForm.textColor.toUpperCase()}
                            onChange={(e) => setEditForm(prev => ({ ...prev, textColor: e.target.value }))}
                            style={{ flex: 1, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 12, fontWeight: 700 }}
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '50%' }}>
                      <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Active Tab / Icon Color</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input 
                          type="color" 
                          value={editForm.iconColor}
                          onChange={(e) => setEditForm(prev => ({ ...prev, iconColor: e.target.value }))}
                          style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer' }}
                        />
                        <input 
                          type="text" 
                          value={editForm.iconColor.toUpperCase()}
                          onChange={(e) => setEditForm(prev => ({ ...prev, iconColor: e.target.value }))}
                          style={{ flex: 1, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 12, fontWeight: 700 }}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Checklist options: isPopular & showOnHome */}
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 12, 
                  padding: '16px', 
                  backgroundColor: '#f8fafc', 
                  border: '1.5px solid #cbd5e1', 
                  borderRadius: 12,
                  marginTop: 8
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Homepage Placement</span>
                  
                  {/* isPopular checkbox */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                    <input 
                      type="checkbox" 
                      checked={editForm.isPopular} 
                      onChange={(e) => setEditForm(prev => ({ ...prev, isPopular: e.target.checked }))}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#10b981' }}
                    />
                    Feature in "Popular Categories" list
                  </label>

                  {/* showOnHome checkbox */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                    <input 
                      type="checkbox" 
                      checked={editForm.showOnHome} 
                      onChange={(e) => setEditForm(prev => ({ ...prev, showOnHome: e.target.checked }))}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#10b981' }}
                    />
                    Show in Homepage Section Grids
                  </label>

                  {/* showInNav checkbox (only for L1 Headers) */}
                  {editingCategory.level === 1 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                      <input 
                        type="checkbox" 
                        checked={editForm.showInNav} 
                        onChange={(e) => setEditForm(prev => ({ ...prev, showInNav: e.target.checked }))}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#10b981' }}
                      />
                      Show in Sub-Navigation Bar
                    </label>
                  )}
                </div>

              </div>

              {/* Form Footer Actions */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                alignItems: 'center', 
                gap: 16, 
                marginTop: 24, 
                paddingTop: 16, 
                borderTop: '1px solid #e2e8f0', 
                boxSizing: 'border-box' 
              }}>
                <button 
                  type="button"
                  onClick={() => { setShowEditModal(false); setEditingCategory(null); setEditIconFile(null); setEditImageFile(null); }}
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 20px',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Save Changes
                </button>
              </div>

            </form>

          </div>
        </ModalPortal>
      )}

    </div>
  );
};

export default CategoriesTab;
