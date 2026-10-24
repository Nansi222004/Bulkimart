/**
 * NOTE: the demo product arrays that used to live here have been removed.
 * The customer app now reads real listings from the API via
 * modules/User/hooks/useProducts.js, so a section stays empty until a seller
 * publishes into it. These exports are kept (empty) so nothing that still
 * imports them breaks.
 */

// Import product assets
import turmericImg from '../../../assets/product_turmeric.png';
import pickleImg from '../../../assets/product_pickle.png';
import honeyImg from '../../../assets/product_honey.png';
import riceImg from '../../../assets/product_rice.png';

// Import vegetable assets
import vegSpongeGourd from '../../../assets/veg_sponge_gourd.png';
import vegOkra from '../../../assets/veg_okra.png';
import vegPotato from '../../../assets/veg_potato.png';
import vegLauki from '../../../assets/veg_lauki.png';
import vegGinger from '../../../assets/veg_ginger.png';
import vegTomato from '../../../assets/veg_tomato.png';
import vegCucumber from '../../../assets/veg_cucumber.png';

// Import newly generated milk & dairy assets
import milkImg from '../../../assets/product_milk_bottle.png';
import paneerImg from '../../../assets/product_paneer_block.png';
import curdImg from '../../../assets/product_curd_cup.png';
import gheeImg from '../../../assets/product_ghee_jar.png';
import butterImg from '../../../assets/product_butter_pack.png';

// Import newly generated electronics assets
import lanternImg from '../../../assets/product_solar_lantern.png';
import bulbImg from '../../../assets/product_emergency_bulb.png';
import chargerImg from '../../../assets/product_solar_charger.png';
import torchImg from '../../../assets/product_rechargeable_torch.png';
import deskFanImg from '../../../assets/product_solar_desk_fan.png';

// Import newly generated mens wear assets
import mensCottonShirtImg from '../../../assets/product_mens_cotton_shirt.png';
import mensDenimJeansImg from '../../../assets/product_mens_denim_jeans.png';
import mensPoloTshirtImg from '../../../assets/product_mens_polo_tshirt.png';
import mensKurtaImg from '../../../assets/product_mens_kurta.png';
import mensTrackPantsImg from '../../../assets/product_mens_track_pants.png';

// Import newly generated womens wear assets
import womensCottonSareeImg from '../../../assets/product_womens_cotton_saree.png';
import womensAnarkaliImg from '../../../assets/product_womens_anarkali.png';
import womensKurtiImg from '../../../assets/product_womens_kurti.png';
import womensPalazzoImg from '../../../assets/product_womens_palazzo.png';
import womensDupattaImg from '../../../assets/product_womens_dupatta.png';

// Import newly generated kids wear assets
import kidsCottonTshirtImg from '../../../assets/product_kids_cotton_tshirt.png';
import kidsUniformImg from '../../../assets/product_kids_uniform.png';
import kidsFrockImg from '../../../assets/product_kids_frock.png';
import kidsRomperImg from '../../../assets/product_kids_romper.png';
import kidsTracksuitImg from '../../../assets/product_kids_tracksuit.png';

// Categories data with direct SVG icon definitions or image markers
export const POPULAR_CATEGORIES = [
  { id: 'grocery', name: 'Grocery', image: 'jar' },
  { id: 'organic', name: 'Organic Food', image: 'organic' },
  { id: 'handmade', name: 'Handmade', image: 'handmade' },
  { id: 'spices', name: 'Spices', image: 'spices' },
  { id: 'pickles', name: 'Pickles', image: 'pickles' }
];

// Quick actions grid data
export const QUICK_ACTIONS = [
  {
    id: 'categories',
    title: 'Categories',
    subtitle: 'Explore all',
    icon: 'grid',
    color: 'var(--sf-highlight, #FFF0B3)',
    iconColor: 'var(--sf-action-hover, #B50918)'
  },
  {
    id: 'offers',
    title: 'Offers',
    subtitle: 'Best deals',
    icon: 'ticket',
    color: 'var(--sf-highlight)',
    iconColor: 'var(--sf-highlight-text)'
  },
  {
    id: 'wholesale',
    title: 'Wholesale',
    subtitle: 'Bulk quantities',
    icon: 'bulk',
    color: 'var(--sf-highlight, #FFF0B3)',
    iconColor: 'var(--sf-action-hover, #B50918)'
  }
];

// Products list for Top Products (all quick/standard)
export const PRODUCTS = [];

// Vegetables List (3-column layout)
export const VEGETABLE_PRODUCTS = [];

// Milk & Dairy List (3-column layout)
export const MILK_PRODUCTS = [];

// Electronics List (3-column layout)
export const ELECTRONICS_PRODUCTS = [];

// Mens Wear List (3-column layout)
export const MENS_WEAR_PRODUCTS = [];

// Womens Wear List (3-column layout)
export const WOMENS_WEAR_PRODUCTS = [];

// Child Wear List (3-column layout)
export const CHILD_WEAR_PRODUCTS = [];
