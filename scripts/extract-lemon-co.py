#!/usr/bin/env python3
import json
import os
import sys
import openpyxl

def main():
    xlsx_path = os.environ.get('CENTRAL_BLOC_XLSX')
    if not xlsx_path or not os.path.exists(xlsx_path):
        candidates = [
            os.path.join(os.path.dirname(__file__), 'data', 'CENTRAL BLOC.xlsx'),
            '/Users/rsatina/Downloads/CENTRAL BLOC.xlsx',
        ]
        for c in candidates:
            if os.path.exists(c):
                xlsx_path = c
                break

    if not xlsx_path or not os.path.exists(xlsx_path):
        print(f"Error: XLSX file not found in candidates: {candidates}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading workbook from {xlsx_path}...")
    wb_v = openpyxl.load_workbook(xlsx_path, data_only=True)
    wb_f = openpyxl.load_workbook(xlsx_path, data_only=False)

    sheet_v = wb_v['October 2026']
    sheet_f = wb_f['October 2026']

    # 1. Detect all 31 days
    day_starts = []
    for r in range(1, sheet_v.max_row + 1):
        c3 = sheet_v.cell(r, 3).value
        c4 = sheet_v.cell(r, 4).value
        c5 = sheet_v.cell(r, 5).value
        if c3 == 'OLD FASHIONED' and c4 == 'WSS' and c5 == '12 OZ':
            b_val = sheet_v.cell(r, 2).value
            d_str = str(b_val)[:10]
            day_starts.append((d_str, r))

    print(f"Found {len(day_starts)} days in sheet October 2026.")

    # 2. Extract products, prices, recipes, and daily sales
    # Ingredient definitions map
    ingredients_dict = {
        'Fresh Lemon': {'unit': 'pc', 'category': 'RAW_MATERIAL', 'costPerUnit': 12.00, 'lowStockThreshold': 50},
        'White Sugar Syrup': {'unit': 'kg', 'category': 'RAW_MATERIAL', 'costPerUnit': 45.00, 'lowStockThreshold': 10},
        'Brown Sugar Syrup': {'unit': 'kg', 'category': 'RAW_MATERIAL', 'costPerUnit': 45.00, 'lowStockThreshold': 10},
        'Purified Water': {'unit': 'gal', 'category': 'RAW_MATERIAL', 'costPerUnit': 25.00, 'lowStockThreshold': 5},
        'Mango Puree': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.15, 'lowStockThreshold': 1000},
        'Watermelon Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.15, 'lowStockThreshold': 1000},
        'Cucumber Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.15, 'lowStockThreshold': 1000},
        'Ginger Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 1000},
        'Pure Honey': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.25, 'lowStockThreshold': 1000},
        'Strawberry Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 1000},
        'Yakult': {'unit': 'pc', 'category': 'RAW_MATERIAL', 'costPerUnit': 12.00, 'lowStockThreshold': 20},
        'Watermelon Sour Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 500},
        'Blue Lemonade Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 500},
        'Guyabano Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 500},
        'Mango Pineapple Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 500},
        'Monster Energy Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.20, 'lowStockThreshold': 500},
        'Orange Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.18, 'lowStockThreshold': 500},
        'Dragonfruit Syrup': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.22, 'lowStockThreshold': 1000},
        'Powdered Milk': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.12, 'lowStockThreshold': 200},
        '12 OZ Cold Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.50, 'lowStockThreshold': 100},
        '16 OZ Cold Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.80, 'lowStockThreshold': 100},
        '22 OZ Cold Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 2.20, 'lowStockThreshold': 100},
        '1 Liter Cup / Bottle': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 5.00, 'lowStockThreshold': 50},
        '12 OZ Hot Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 2.00, 'lowStockThreshold': 50},
        '90mm Flat Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 0.80, 'lowStockThreshold': 100},
        '90mm Dome Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.00, 'lowStockThreshold': 50},
        '95mm Dome Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.20, 'lowStockThreshold': 50},
        '95mm Flat / Plastic Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 0.90, 'lowStockThreshold': 100},
        'Regular Straw': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 0.25, 'lowStockThreshold': 100},
        'Boba Straw': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 0.50, 'lowStockThreshold': 50},
        'Takeout Solo Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.00, 'lowStockThreshold': 20},
        'Takeout Duo Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.50, 'lowStockThreshold': 20},
        'Thermal Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 15.00, 'lowStockThreshold': 10},
        'Tote Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 20.00, 'lowStockThreshold': 10},
        'Food Prep Gloves': {'unit': 'pair', 'category': 'PACKAGING', 'costPerUnit': 1.00, 'lowStockThreshold': 10},
        'Trash Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 3.00, 'lowStockThreshold': 10},
        'Tissue': {'unit': 'pack', 'category': 'PACKAGING', 'costPerUnit': 10.00, 'lowStockThreshold': 10},
    }

    # Extract all distinct products across all 31 days
    all_products = {}
    
    # Store daily parsed information
    daily_data = []

    for date_str, start_r in day_starts:
        # Find the 4 subtotals for this day
        subtotals = []
        for offset in range(130):
            r = start_r + offset
            c3 = str(sheet_v.cell(r, 3).value or '').strip()
            if 'sub' in c3.lower() and 'total' in c3.lower():
                subtotals.append(r)
        
        if len(subtotals) < 4:
            print(f"Warning: less than 4 subtotals on {date_str}: {subtotals}")
            continue

        r_sub_12, r_sub_22, r_sub_1l, r_sub_16 = subtotals[:4]

        # Product row ranges:
        ranges = [
            (start_r, r_sub_12, '12 OZ'),
            (r_sub_12 + 1, r_sub_22, '22 OZ'),
            (r_sub_22 + 1, r_sub_1l, '1 Liter'),
            (r_sub_1l + 1, r_sub_16, '16 OZ'),
        ]

        day_sold_items = []
        day_total_sales = 0.0

        for r_start, r_end, default_size in ranges:
            for r in range(r_start, r_end):
                raw_name = sheet_v.cell(r, 3).value
                variant = sheet_v.cell(r, 4).value
                size = sheet_v.cell(r, 5).value or default_size
                price = sheet_v.cell(r, 6).value

                if not raw_name:
                    continue
                name_clean = str(raw_name).strip()
                if 'total' in name_clean.lower() or name_clean == 'ITEM':
                    continue

                size_clean = str(size).strip()
                variant_clean = str(variant).strip() if variant else None

                # Construct canonical product key & name
                name_parts = [name_clean]
                if variant_clean:
                    name_parts.append(f"({variant_clean})")
                name_parts.append(size_clean)
                full_product_name = " ".join(name_parts)

                # Determine category
                if 'ADD ON' in name_clean.upper():
                    cat = 'Add-on'
                elif 'OLD FASHIONED' in name_clean.upper():
                    cat = 'Old Fashioned'
                elif 'SHAKE' in name_clean.upper() or 'FROSTY' in name_clean.upper() or 'BURST' in name_clean.upper():
                    cat = 'Specialty & Shakes'
                else:
                    cat = 'Flavored Lemonade'

                # Recipe calculation from formula
                lemon_f = sheet_f.cell(r, 17).value
                flavor_f = sheet_f.cell(r, 18).value

                # Determine lemon qty
                lemon_qty = 0.0
                if size_clean == '12 OZ':
                    lemon_qty = 0.5
                elif size_clean in ['16 OZ', '16oz', '22 OZ']:
                    lemon_qty = 1.0
                elif size_clean == '1 Liter':
                    lemon_qty = 2.0
                elif name_clean.upper() == 'ADD ON LEMON':
                    lemon_qty = 1.0

                # Determine flavor ingredient and grams
                flavor_ing = None
                flavor_grams = 0.0
                name_u = name_clean.upper()

                if 'MANGO PINEAPPLE' in name_u:
                    flavor_ing = 'Mango Pineapple Syrup'
                    flavor_grams = 50.0
                elif 'MANGO' in name_u:
                    flavor_ing = 'Mango Puree'
                    if size_clean == '12 OZ': flavor_grams = 100.0
                    elif size_clean == '22 OZ': flavor_grams = 200.0
                    elif size_clean == '1 Liter': flavor_grams = 350.0
                    else: flavor_grams = 50.0
                elif 'WATERMELON SOUR' in name_u:
                    flavor_ing = 'Watermelon Sour Syrup'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    elif size_clean == '1 Liter': flavor_grams = 200.0
                    else: flavor_grams = 50.0
                elif 'WATERMELON' in name_u:
                    flavor_ing = 'Watermelon Flavor'
                    if size_clean == '12 OZ': flavor_grams = 150.0
                    elif size_clean == '22 OZ': flavor_grams = 300.0
                    elif size_clean == '1 Liter': flavor_grams = 450.0
                    else: flavor_grams = 50.0
                elif 'CUCUMBER' in name_u:
                    flavor_ing = 'Cucumber Flavor'
                    if size_clean == '12 OZ': flavor_grams = 100.0
                    elif size_clean == '22 OZ': flavor_grams = 200.0
                    elif size_clean == '1 Liter': flavor_grams = 350.0
                    else: flavor_grams = 50.0
                elif 'GINGER' in name_u and 'HONEY' not in name_u:
                    flavor_ing = 'Ginger Flavor'
                    if size_clean == '12 OZ': flavor_grams = 100.0
                    elif size_clean == '22 OZ': flavor_grams = 200.0
                    elif size_clean == '1 Liter': flavor_grams = 350.0
                    else: flavor_grams = 50.0
                elif 'HONEY GINGER' in name_u:
                    flavor_ing = 'Ginger Flavor'
                    flavor_grams = 50.0
                elif 'HONEY' in name_u:
                    flavor_ing = 'Pure Honey'
                    if size_clean == '12 OZ': flavor_grams = 50.0
                    elif size_clean == '22 OZ': flavor_grams = 100.0
                    elif size_clean == '1 Liter': flavor_grams = 150.0
                    else: flavor_grams = 50.0
                elif 'STRAWBERRY' in name_u or 'STRAWBERY' in name_u:
                    flavor_ing = 'Strawberry Flavor'
                    if size_clean == '12 OZ': flavor_grams = 50.0
                    elif size_clean == '22 OZ': flavor_grams = 100.0
                    elif size_clean == '1 Liter': flavor_grams = 200.0
                    else: flavor_grams = 50.0
                elif 'YAKULT' in name_u:
                    flavor_ing = 'Yakult'
                    if size_clean in ['22 OZ', '1 Liter']: flavor_grams = 2.0
                    else: flavor_grams = 1.0
                elif 'BLUE LEMONADE' in name_u:
                    flavor_ing = 'Blue Lemonade Syrup'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    elif size_clean == '1 Liter': flavor_grams = 200.0
                    else: flavor_grams = 50.0
                elif 'GUYABANO' in name_u:
                    flavor_ing = 'Guyabano Syrup'
                    if size_clean == '16 OZ': flavor_grams = 75.0
                    elif size_clean == '22 OZ': flavor_grams = 100.0
                    else: flavor_grams = 50.0
                elif 'MONSTER' in name_u:
                    flavor_ing = 'Monster Energy Syrup'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    else: flavor_grams = 50.0
                elif 'ORANGE' in name_u:
                    flavor_ing = 'Orange Syrup'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    else: flavor_grams = 50.0
                elif 'DRAGONFRUIT' in name_u:
                    flavor_ing = 'Dragonfruit Syrup'
                    if size_clean == '16 OZ': flavor_grams = 87.5
                    elif size_clean == '22 OZ': flavor_grams = 200.0
                    else: flavor_grams = 100.0
                elif 'TROPICAL BURST' in name_u:
                    flavor_ing = 'Mango Puree'
                    flavor_grams = 50.0
                elif 'MERRY BERRY POP' in name_u:
                    flavor_ing = 'Strawberry Flavor'
                    flavor_grams = 50.0

                # Recipe recipeLines
                recipe_lines = []
                if lemon_qty > 0 and 'ADD ON' not in name_u:
                    recipe_lines.append({'ingredientName': 'Fresh Lemon', 'qty': lemon_qty})
                elif name_u == 'ADD ON LEMON':
                    recipe_lines.append({'ingredientName': 'Fresh Lemon', 'qty': 1.0})

                if flavor_ing and flavor_grams > 0:
                    recipe_lines.append({'ingredientName': flavor_ing, 'qty': flavor_grams})

                if 'HONEY GINGER' in name_u:
                    recipe_lines.append({'ingredientName': 'Pure Honey', 'qty': 50.0})

                if 'SHAKE' in name_u:
                    recipe_lines.append({'ingredientName': 'Powdered Milk', 'qty': 25.0})

                if variant_clean == 'WSS':
                    recipe_lines.append({'ingredientName': 'White Sugar Syrup', 'qty': 0.03})
                elif variant_clean == 'BSS':
                    recipe_lines.append({'ingredientName': 'Brown Sugar Syrup', 'qty': 0.03})

                # Packaging
                if 'ADD ON' not in name_u:
                    if variant_clean == 'HOT':
                        recipe_lines.append({'ingredientName': '12 OZ Hot Cup', 'qty': 1.0})
                    elif size_clean == '12 OZ':
                        recipe_lines.append({'ingredientName': '12 OZ Cold Cup', 'qty': 1.0})
                        if 'FROSTY' in name_u:
                            recipe_lines.append({'ingredientName': '90mm Dome Lid', 'qty': 1.0})
                            recipe_lines.append({'ingredientName': 'Boba Straw', 'qty': 1.0})
                        else:
                            recipe_lines.append({'ingredientName': '90mm Flat Lid', 'qty': 1.0})
                            recipe_lines.append({'ingredientName': 'Regular Straw', 'qty': 1.0})
                    elif size_clean in ['16 OZ', '16oz']:
                        recipe_lines.append({'ingredientName': '16 OZ Cold Cup', 'qty': 1.0})
                        recipe_lines.append({'ingredientName': '90mm Flat Lid', 'qty': 1.0})
                        recipe_lines.append({'ingredientName': 'Regular Straw', 'qty': 1.0})
                    elif size_clean == '22 OZ':
                        recipe_lines.append({'ingredientName': '22 OZ Cold Cup', 'qty': 1.0})
                        if 'FROSTY' in name_u or 'SHAKE' in name_u:
                            recipe_lines.append({'ingredientName': '95mm Dome Lid', 'qty': 1.0})
                            recipe_lines.append({'ingredientName': 'Boba Straw', 'qty': 1.0})
                        else:
                            recipe_lines.append({'ingredientName': '95mm Flat / Plastic Lid', 'qty': 1.0})
                            recipe_lines.append({'ingredientName': 'Regular Straw', 'qty': 1.0})
                    elif size_clean == '1 Liter':
                        recipe_lines.append({'ingredientName': '1 Liter Cup / Bottle', 'qty': 1.0})
                        recipe_lines.append({'ingredientName': 'Regular Straw', 'qty': 1.0})

                # Register product
                clean_slug = "".join(c if c.isalnum() else "-" for c in name_clean.upper()).strip("-")
                variant_part = f"-{variant_clean.upper()}" if variant_clean else ""
                size_part = f"-{size_clean.upper().replace(' ', '')}"
                sku_candidate = f"LEM-{clean_slug[:15]}{variant_part}{size_part}"

                price_num = float(price) if price is not None and price != '' else None

                if full_product_name not in all_products:
                    # Ensure SKU uniqueness
                    final_sku = sku_candidate
                    counter = 1
                    existing_skus = {p['sku'] for p in all_products.values()}
                    while final_sku in existing_skus:
                        final_sku = f"{sku_candidate}-{counter}"
                        counter += 1

                    all_products[full_product_name] = {
                        'name': full_product_name,
                        'category': cat,
                        'size': size_clean,
                        'variant': variant_clean,
                        'sku': final_sku,
                        'type': 'READY_MADE' if 'ADD ON' in name_u and not recipe_lines else 'RECIPE',
                        'price': price_num or 100.0,
                        'recipeLines': recipe_lines,
                    }
                elif price_num is not None:
                    all_products[full_product_name]['price'] = price_num

                # Check sales numbers for today
                cash_q = float(sheet_v.cell(r, 7).value or 0)
                cash_a = float(sheet_v.cell(r, 8).value or 0)
                ew_q = float(sheet_v.cell(r, 9).value or 0)
                ew_a = float(sheet_v.cell(r, 10).value or 0)
                gr_q = float(sheet_v.cell(r, 11).value or 0)
                gr_a = float(sheet_v.cell(r, 12).value or 0)
                sn_q = float(sheet_v.cell(r, 13).value or 0)
                sn_a = float(sheet_v.cell(r, 14).value or 0)
                tot_q = float(sheet_v.cell(r, 15).value or 0)
                tot_a = float(sheet_v.cell(r, 16).value or 0)

                if tot_q > 0:
                    day_sold_items.append({
                        'productName': full_product_name,
                        'price': price_num or (tot_a / tot_q),
                        'cashQty': cash_q,
                        'cashAmount': cash_a,
                        'ewalletQty': ew_q,
                        'ewalletAmount': ew_a,
                        'grabQty': gr_q,
                        'grabAmount': gr_a,
                        'seniorQty': sn_q,
                        'seniorAmount': sn_a,
                        'totalQty': tot_q,
                        'totalAmount': tot_a,
                    })
                    day_total_sales += tot_a

        # Extract Summary Numbers
        summary = {}
        for offset in range(115, 140):
            r = start_r + offset
            c3 = sheet_v.cell(r, 3).value
            c5 = sheet_v.cell(r, 5).value
            if c3 in ['CASH SALES', 'EWALLET SALES', 'GRAB SALES', 'SENIOR/PWD SALES', 'EXPENSES', 'FOOD ALLOWANCE', 'BALANCE FOR DEPOSIT', 'TOTAL SALES']:
                summary[c3] = float(c5) if c5 is not None else 0.0
            if c5 is not None and 'TOTAL SALES' not in summary:
                if sheet_v.cell(r - 1, 3).value == 'BALANCE FOR DEPOSIT':
                    summary['TOTAL SALES'] = float(c5)

        # Extract Lemon Inventory
        r_lemon = start_r + 130
        lemon_used = float(sheet_v.cell(r_lemon, 6).value or 0)
        lemon_start = float(sheet_v.cell(r_lemon, 7).value or 0)
        lemon_in = float(sheet_v.cell(r_lemon, 8).value or 0) if isinstance(sheet_v.cell(r_lemon, 8).value, (int, float)) else 0.0
        lemon_end = float(sheet_v.cell(r_lemon, 9).value or 0)

        # Extract Flavors Inventory
        flavor_items = []
        for offset in range(133, 152):
            r = start_r + offset
            fname = sheet_v.cell(r, 3).value
            if fname and fname not in ['FLAVOR USED', 'USED']:
                used_p = float(sheet_v.cell(r, 5).value or 0) if isinstance(sheet_v.cell(r, 5).value, (int, float)) else 0.0
                used_g = float(sheet_v.cell(r, 6).value or 0) if isinstance(sheet_v.cell(r, 6).value, (int, float)) else 0.0
                start_g = float(sheet_v.cell(r, 7).value or 0) if isinstance(sheet_v.cell(r, 7).value, (int, float)) else 0.0
                in_g = float(sheet_v.cell(r, 8).value or 0) if isinstance(sheet_v.cell(r, 8).value, (int, float)) else 0.0
                end_g = float(sheet_v.cell(r, 9).value or 0) if isinstance(sheet_v.cell(r, 9).value, (int, float)) else 0.0
                flavor_items.append({
                    'name': str(fname).strip(),
                    'usedPortions': used_p,
                    'used': used_g,
                    'start': start_g,
                    'in': in_g,
                    'end': end_g,
                })

        # Extract Packaging & Supplies Inventory
        supplies_items = []
        for offset in range(121, 148):
            r = start_r + offset
            i1 = sheet_v.cell(r, 11).value
            i2 = sheet_v.cell(r, 12).value
            item_name = f"{i1 or ''} {i2 or ''}".strip()
            if item_name and item_name not in ['USED', 'START', 'IN', 'END', 'partial:', 'balance', 'senior']:
                used = float(sheet_v.cell(r, 13).value or 0) if isinstance(sheet_v.cell(r, 13).value, (int, float)) else 0.0
                start = float(sheet_v.cell(r, 14).value or 0) if isinstance(sheet_v.cell(r, 14).value, (int, float)) else 0.0
                in_val = float(sheet_v.cell(r, 15).value or 0) if isinstance(sheet_v.cell(r, 15).value, (int, float)) else 0.0
                end = float(sheet_v.cell(r, 16).value or 0) if isinstance(sheet_v.cell(r, 16).value, (int, float)) else 0.0
                supplies_items.append({
                    'name': item_name,
                    'used': used,
                    'start': start,
                    'in': in_val,
                    'end': end,
                })

        daily_data.append({
            'date': date_str,
            'summary': summary,
            'soldItems': day_sold_items,
            'totalSalesCalculated': day_total_sales,
            'inventory': {
                'lemon': {
                    'start': lemon_start,
                    'in': lemon_in,
                    'used': lemon_used,
                    'end': lemon_end,
                },
                'flavors': flavor_items,
                'supplies': supplies_items,
            }
        })

    # Build unique list of deliveries
    deliveries = []
    for d in daily_data:
        date_str = d['date']
        # lemon in
        if d['inventory']['lemon']['in'] > 0:
            deliveries.append({
                'date': date_str,
                'ingredientName': 'Fresh Lemon',
                'qty': d['inventory']['lemon']['in']
            })
        for f in d['inventory']['flavors']:
            if f['in'] != 0:
                # Map flavor name to ingredient name
                ing_map = {
                    'MANGO': 'Mango Puree',
                    'WATERMELON': 'Watermelon Flavor',
                    'CUCUMBER': 'Cucumber Flavor',
                    'GINGER': 'Ginger Flavor',
                    'HONEY': 'Pure Honey',
                    'STRAWBERRY': 'Strawberry Flavor',
                    'YAKULT': 'Yakult',
                    'WATERMELON SOUR': 'Watermelon Sour Syrup',
                    'BLUE LEMONADE': 'Blue Lemonade Syrup',
                    'GUYABANO': 'Guyabano Syrup',
                    'MANGO PINEAPPLE': 'Mango Pineapple Syrup',
                    'MONSTER LEMONADE': 'Monster Energy Syrup',
                    'ORANGE LEMONADE': 'Orange Syrup',
                    'DRAGONFRUIT LEMONADE': 'Dragonfruit Syrup',
                    'POWDERED MILK': 'Powdered Milk',
                }
                mapped = ing_map.get(f['name'].upper(), f['name'])
                deliveries.append({
                    'date': date_str,
                    'ingredientName': mapped,
                    'qty': f['in']
                })
        for s in d['inventory']['supplies']:
            if s['in'] != 0:
                sup_map = {
                    '12 OZ CUPS': '12 OZ Cold Cup',
                    '22 OZ CUPS': '22 OZ Cold Cup',
                    '1 LITER': '1 Liter Cup / Bottle',
                    '12 OZ HOT': '12 OZ Hot Cup',
                    '16 OZ CUPS': '16 OZ Cold Cup',
                    'STRAW': 'Regular Straw',
                    'WSS': 'White Sugar Syrup',
                    'BSS': 'Brown Sugar Syrup',
                    'WATER': 'Purified Water',
                    'TOTE BAGS': 'Tote Bag',
                    'TISSUE': 'Tissue',
                    'GLOVES': 'Food Prep Gloves',
                    'TRASH BAG': 'Trash Bag',
                    '90 mm LIDS': '90mm Flat Lid',
                    '90 mm DOME LIDS': '90mm Dome Lid',
                    '95 mm DOME LIDS': '95mm Dome Lid',
                    'BOBA STRAW': 'Boba Straw',
                    '95 mm PLASTIC LIDS': '95mm Flat / Plastic Lid',
                    'TO- SOLO': 'Takeout Solo Bag',
                    'TO- DUO': 'Takeout Duo Bag',
                    'THERMAL': 'Thermal Bag',
                }
                mapped = sup_map.get(s['name'], s['name'])
                deliveries.append({
                    'date': date_str,
                    'ingredientName': mapped,
                    'qty': s['in']
                })

    output_payload = {
        'company': {
            'name': 'Lemon Co.',
            'timezone': 'Asia/Manila',
            'currency': 'PHP',
            'storeType': 'RETAIL',
        },
        'ingredients': ingredients_dict,
        'products': list(all_products.values()),
        'deliveries': deliveries,
        'dailyData': daily_data,
    }

    out_file = os.path.join(os.path.dirname(__file__), 'data', 'lemon-co-oct-2026.json')
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, 'w') as f:
        json.dump(output_payload, f, indent=2)

    print(f"Successfully extracted Lemon Co. dataset to {out_file}!")
    print(f"Summary:")
    print(f" - Ingredients defined: {len(ingredients_dict)}")
    print(f" - Products created: {len(all_products)}")
    print(f" - Deliveries/Restocks logged: {len(deliveries)}")
    print(f" - Daily sales & inventory sheets: {len(daily_data)}")
    total_sales_all = sum(d['summary'].get('TOTAL SALES', 0) for d in daily_data)
    print(f" - Total Oct 2026 Sales from sheet summary: PHP {total_sales_all:,.2f}")

if __name__ == '__main__':
    main()
