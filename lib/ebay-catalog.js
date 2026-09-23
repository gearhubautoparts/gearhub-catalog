const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const brands = { '49412844018': 'Porsche', '49412845018': 'Mercedes-Benz', '49412846018': 'Audi', '49412847018': 'BMW', '49412848018': 'Harley-Davidson' };
function amount(value) {
  if (value?.['@_currencyID'] !== 'USD') return null;
  const number = Number(value['#text']);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function catalogProduct(item) {
  const id = String(item.ItemID || '');
  const price = amount(item.SellingStatus?.CurrentPrice);
  if (!/^\d{9,15}$/.test(id) || !item.Title || price === null) throw new Error('Invalid catalog item.');
  const path = String(item.PrimaryCategory?.CategoryName || 'Other Parts');
  const categoryRules = [
    [/Interior|Safety|Seat|Airbag/i, 'Interior & Safety'],
    [/Transmission|Drivetrain|Clutch|Differential|Drive Shaft/i, 'Transmission & Drivetrain'],
    [/Brake|Steering|Suspension|Wheel|Tire/i, 'Suspension, Steering, Brakes & Wheels'],
    [/Air Conditioning|Heating|HVAC/i, 'HVAC & Cooling'],
    [/Engine|Exhaust|Fuel|Cooling/i, 'Engine & Powertrain'],
    [/Electrical|Ignition|Computer|Sensor|ECU/i, 'Electrical & Electronics'],
    [/Body|Exterior|Lighting|Mirror|Fairing|Windshield/i, 'Body, Exterior & Lighting'],
  ];
  const specifics = array(item.ItemSpecifics?.NameValueList);
  const oem = [...new Set(specifics.filter(x => /^(Manufacturer Part Number|OE\/OEM Part Number|Interchange Part Number)$/.test(x.Name)).flatMap(x => array(x.Value)).filter(x => x && !/^(Does not apply|N\/A)$/i.test(x)))];
  const images = array(item.PictureDetails?.PictureURL).filter(value => {
    try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'i.ebayimg.com' && !u.username && !u.password; } catch { return false; }
  });
  const services = array(item.ShippingDetails?.ShippingServiceOptions).filter(x => x.ShippingService !== 'Pickup').sort((a, b) => Number(a.ShippingServicePriority) - Number(b.ShippingServicePriority));
  const shipping = item.ShippingDetails?.ShippingType === 'Flat' ? amount(services[0]?.ShippingServiceCost) : null;
  const compatibility = array(item.ItemCompatibilityList?.Compatibility).map(row => ({
    properties: array(row.NameValueList).map(pair => ({ name: String(pair.Name || ''), values: array(pair.Value).map(String) })).filter(pair => pair.name && pair.values.length),
    notes: String(row.CompatibilityNotes || ''),
  })).filter(row => row.properties.length);
  return {
    id, title: String(item.Title), sku: String(item.SKU || ''), price, shipping,
    brand: brands[item.Storefront?.StoreCategoryID] || 'Other',
    category: categoryRules.find(([pattern]) => pattern.test(path))?.[1] || 'Other Parts',
    subcategory: path.split(':').at(-1), ebayCategory: path,
    oem, condition: String(item.ConditionDisplayName || 'See listing'),
    status: item.SellingStatus?.ListingStatus === 'Active' && Number(item.Quantity) > Number(item.SellingStatus?.QuantitySold || 0) ? 'In stock' : 'Sold',
    compatibility, fitment: 'Contact GearHub to verify compatibility',
    image: images[0] || '', images, source: 'ebay', ebayUrl: `https://www.ebay.com/itm/${id}`,
  };
}
