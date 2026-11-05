#!/usr/bin/env python3
import json
import os
import re
import sys
import openpyxl

SIZE_MAP = {
    '12 OZ': 'Regular',
    '12oz': 'Regular',
    '12 oz': 'Regular',
    '16 OZ': 'Grande',
    '16oz': 'Grande',
    '16 oz': 'Grande',
    '22 OZ': 'Supreme',
    '22oz': 'Supreme',
    '22 oz': 'Supreme',
    '1 Liter': 'Supreme XL',
    '1 liter': 'Supreme XL',
    '1L': 'Supreme XL',
    '1 L': 'Supreme XL',
}

def to_title_case(s: str) -> str:
    s = re.sub(r'\bLEMONDAE\b', 'Lemonade', s, flags=re.IGNORECASE)
    s = re.sub(r'\bSTRAWBERY\b', 'Strawberry', s, flags=re.IGNORECASE)
    s = re.sub(r'\bADD ON\b', 'Add-on', s, flags=re.IGNORECASE)
    s = re.sub(r'\bOLD FASHIONED\b', 'Old-Fashioned', s, flags=re.IGNORECASE)
    s = re.sub(r'\bFROSTY MANGO LEMONADA\b', 'Mango Lemonada', s, flags=re.IGNORECASE)
    s = re.sub(r'\bFROSTY STRAWBERRY LUSH\b', 'Strawberry Lush', s, flags=re.IGNORECASE)
    s = re.sub(r'\bFROSTY STRAWBERY LUSH\b', 'Strawberry Lush', s, flags=re.IGNORECASE)
    words = s.split(' ')
    titled = []
    for w in words:
        if w.lower() == 'add-on':
            titled.append('Add-on')
        elif '-' in w:
            parts = [p.capitalize() for p in w.split('-')]
            titled.append('-'.join(parts))
        else:
            titled.append(w.capitalize())
    return ' '.join(titled)

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
        'Fresh Lemon': {'unit': 'pc', 'category': 'RAW_MATERIAL', 'costPerUnit': 20.00, 'lowStockThreshold': 50},
        'White Sugar': {'unit': 'ml', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.15, 'lowStockThreshold': 1000, 'purchaseUnit': 'L', 'purchaseUnitSize': 1000},
        'Brown Sugar': {'unit': 'ml', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.15, 'lowStockThreshold': 1000, 'purchaseUnit': 'L', 'purchaseUnitSize': 1000},
        'Purified Water': {'unit': 'gal', 'category': 'RAW_MATERIAL', 'costPerUnit': 25.00, 'lowStockThreshold': 5},
        'Mango Puree': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.214, 'lowStockThreshold': 1000},
        'Watermelon Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.214, 'lowStockThreshold': 1000},
        'Cucumber Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.236, 'lowStockThreshold': 1000},
        'Ginger Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.170, 'lowStockThreshold': 1000},
        'Pure Honey': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.5824, 'lowStockThreshold': 1000},
        'Strawberry Flavor': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.256, 'lowStockThreshold': 1000},
        'Yakult': {'unit': 'pc', 'category': 'RAW_MATERIAL', 'costPerUnit': 12.32, 'lowStockThreshold': 20},
        'Watermelon Sour': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.214, 'lowStockThreshold': 500},
        'Blue Lemonade': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.214, 'lowStockThreshold': 500},
        'Guyabano': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.290, 'lowStockThreshold': 500},
        'Mango Pineapple': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.214, 'lowStockThreshold': 500},
        'Monster Energy': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.250, 'lowStockThreshold': 500},
        'Orange': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.214, 'lowStockThreshold': 500},
        'Dragonfruit': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.256, 'lowStockThreshold': 1000},
        'Powdered Milk': {'unit': 'g', 'category': 'RAW_MATERIAL', 'costPerUnit': 0.448, 'lowStockThreshold': 200},
        '12 OZ Cold Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 4.20, 'lowStockThreshold': 100},
        '16 OZ Cold Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 4.37, 'lowStockThreshold': 100},
        '22 OZ Cold Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 6.72, 'lowStockThreshold': 100},
        '1 Liter Cup / Bottle': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 13.44, 'lowStockThreshold': 50},
        '12 OZ Hot Cup': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 13.44, 'lowStockThreshold': 50},
        '90mm Flat Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.45, 'lowStockThreshold': 100},
        '90mm Dome Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.45, 'lowStockThreshold': 50},
        '95mm Dome Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.45, 'lowStockThreshold': 50},
        '95mm Flat / Plastic Lid': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.45, 'lowStockThreshold': 100},
        'Regular Straw': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.40, 'lowStockThreshold': 100},
        'Boba Straw': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.40, 'lowStockThreshold': 50},
        'Takeout Solo Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.00, 'lowStockThreshold': 20},
        'Takeout Duo Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 1.50, 'lowStockThreshold': 20},
        'Thermal Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 15.00, 'lowStockThreshold': 10},
        'Tote Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 20.00, 'lowStockThreshold': 10},
        'Food Prep Gloves': {'unit': 'pair', 'category': 'PACKAGING', 'costPerUnit': 1.00, 'lowStockThreshold': 10},
        'Trash Bag': {'unit': 'pc', 'category': 'PACKAGING', 'costPerUnit': 3.00, 'lowStockThreshold': 10},
        'Tissue': {'unit': 'pack', 'category': 'PACKAGING', 'costPerUnit': 10.00, 'lowStockThreshold': 10},
    }

    # Food cost table from NEW-COSTING-AND-PRICING-FOR-FRANCHISEES Excel sheet (COST OF FOOD)
    excel_food_costs = {
        ('MANGO', '12 OZ'): 57.20,
        ('MANGO', '16 OZ'): 81.82,
        ('MANGO', '22 OZ'): 94.87,
        ('MANGO', '1 LITER'): 158.34,
        ('CUCUMBER', '12 OZ'): 63.15,
        ('CUCUMBER', '16 OZ'): 88.87,
        ('CUCUMBER', '22 OZ'): 106.77,
        ('CUCUMBER', '1 LITER'): 181.04,
        ('GINGER', '12 OZ'): 56.55,
        ('GINGER', '16 OZ'): 78.97,
        ('GINGER', '22 OZ'): 93.57,
        ('GINGER', '1 LITER'): 157.94,
        ('STRAWBERRY', '12 OZ'): 52.35,
        ('STRAWBERRY', '16 OZ'): 68.92,
        ('STRAWBERRY', '22 OZ'): 85.17,
        ('STRAWBERRY', '1 LITER'): 149.64,
        ('WATERMELON', '12 OZ'): 64.15,
        ('WATERMELON', '16 OZ'): 90.37,
        ('WATERMELON', '22 OZ'): 108.77,
        ('WATERMELON', '1 LITER'): 164.74,
        ('HONEY GINGER', '12 OZ'): 107.25,
        ('HONEY GINGER', '16 OZ'): 155.02,
        ('HONEY GINGER', '22 OZ'): 209.97,
        ('HONEY GINGER', '1 LITER'): 361.64,
        ('YAKULT', '12 OZ'): 51.87,
        ('YAKULT', '16 OZ'): 65.79,
        ('YAKULT', '22 OZ'): 84.21,
        ('YAKULT', '1 LITER'): 123.08,
        ('OFL', '12 OZ'): 39.55,
        ('OFL', '16 OZ'): 53.47,
        ('OFL', '22 OZ'): 59.57,
        ('OFL', '1 LITER'): 98.44,
        ('HONEY', '12 OZ'): 61.17,
        ('HONEY', '16 OZ'): 85.90,
        ('HONEY', '22 OZ'): 102.81,
        ('HONEY', '1 LITER'): 155.80,
        ('STRAWBERRY LUSH', '12 OZ'): 63.55,
        ('STRAWBERRY LUSH', '16 OZ'): 95.07,
        ('STRAWBERRY LUSH', '22 OZ'): 107.57,
        ('MANGO LEMONADA', '12 OZ'): 68.40,
        ('MANGO LEMONADA', '16 OZ'): 104.22,
        ('MANGO LEMONADA', '22 OZ'): 117.27,
        ('OFL HOT', '12 OZ'): 45.94,
        ('GINGER HOT', '12 OZ'): 62.94,
        ('HONEY LEMONADE HOT', '12 OZ'): 67.54,
        ('HONEY GINGER HOT', '12 OZ'): 87.94,
        ('GUYABANO', '12 OZ'): 44.05,
        ('GUYABANO', '16 OZ'): 65.22,
        ('GUYABANO', '22 OZ'): 78.57,
    }

    def get_product_cost(name: str, recipe_lines: list) -> float:
        p = name.upper()
        size = None
        if 'REGULAR' in p: size = '12 OZ'
        elif 'GRANDE' in p: size = '16 OZ'
        elif 'SUPREME XL' in p: size = '1 LITER'
        elif 'SUPREME' in p: size = '22 OZ'

        base = None
        if 'OLD-FASHIONED' in p:
            base = 'OFL HOT' if '(HOT)' in p else 'OFL'
        elif 'MANGO LEMONADA' in p:
            base = 'MANGO LEMONADA'
        elif 'MANGO' in p and 'PINEAPPLE' not in p:
            base = 'MANGO'
        elif 'STRAWBERRY LUSH' in p:
            base = 'STRAWBERRY LUSH'
        elif 'STRAWBERRY' in p:
            base = 'STRAWBERRY'
        elif 'CUCUMBER' in p:
            base = 'CUCUMBER'
        elif 'HONEY GINGER' in p:
            base = 'HONEY GINGER HOT' if '(HOT)' in p else 'HONEY GINGER'
        elif 'GINGER' in p:
            base = 'GINGER HOT' if '(HOT)' in p else 'GINGER'
        elif 'HONEY' in p and 'ADD-ON' not in p and 'ADD ON' not in p:
            base = 'HONEY LEMONADE HOT' if '(HOT)' in p else 'HONEY'
        elif 'YAKULT' in p:
            base = 'YAKULT'
        elif 'WATERMELON' in p and 'SOUR' not in p:
            base = 'WATERMELON'
        elif 'GUYABANO' in p:
            base = 'GUYABANO'

        if base and size and (base, size) in excel_food_costs:
            return excel_food_costs[(base, size)]

        # Calculate from recipe lines + misc packaging (water/ice/napkin 15.0 for drinks)
        recipe_cost = sum(
            rl['qty'] * ingredients_dict.get(rl['ingredientName'], {}).get('costPerUnit', 0.0)
            for rl in recipe_lines
        )
        is_packaged_drink = 'ADD-ON' not in p and 'ADD ON' not in p and len(recipe_lines) > 0
        misc_cost = 15.0 if is_packaged_drink else 0.0
        return round(recipe_cost + misc_cost, 2)

    def get_sugar_ml(name_u: str, size_clean: str) -> float:
        if 'ADD ON' in name_u or 'ADD-ON' in name_u:
            return 0.0
        if 'WATERMELON' in name_u and 'SOUR' not in name_u:
            return 0.0
        if 'HONEY' in name_u and 'GINGER' not in name_u:
            return 0.0
        if 'HONEY GINGER' in name_u or 'HONEYGINGER' in name_u:
            if size_clean in ['12 OZ', '16 OZ', '16oz'] or 'HOT' in name_u:
                return 0.0
            elif size_clean == '22 OZ':
                return 100.0
            elif size_clean in ['1 Liter', '1L']:
                return 200.0
        if 'MANGO' in name_u and 'PINEAPPLE' not in name_u:
            if size_clean == '12 OZ': return 25.0
            elif size_clean in ['16 OZ', '16oz', '22 OZ']: return 50.0
            elif size_clean in ['1 Liter', '1L']: return 100.0
            return 25.0
        if 'STRAWBERRY' in name_u and 'LUSH' not in name_u and size_clean in ['16 OZ', '16oz']:
            return 50.0

        if size_clean == '12 OZ':
            return 50.0
        elif size_clean in ['16 OZ', '16oz']:
            return 75.0
        elif size_clean == '22 OZ':
            return 100.0
        elif size_clean in ['1 Liter', '1L']:
            return 200.0
        return 50.0

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

                if not raw_name:
                    if (cash_a + ew_a + gr_a + sn_a + tot_a) > 0:
                        # Handle unnamed row with sales (e.g. Oct 3 row 347 with 128 PHP in 12 OZ E-Wallet)
                        raw_name = 'FROSTY MANGO LEMONADA'
                        price = price or 128.0
                    else:
                        continue
                name_clean = str(raw_name).strip()
                if 'total' in name_clean.lower() or name_clean == 'ITEM':
                    continue

                size_clean = str(size).strip()
                size_mapped = SIZE_MAP.get(size_clean, size_clean.capitalize())
                variant_clean = str(variant).strip() if variant else None

                name_u = name_clean.upper()
                is_hot = (variant_clean and variant_clean.upper() == 'HOT') or 'HOT' in name_u
                is_add_on = 'ADD ON' in name_u or 'ADD-ON' in name_u
                is_old_fashioned = 'OLD FASHIONED' in name_u
                is_shake = any(kw in name_u for kw in ['SHAKE', 'FROSTY', 'LEMONADA', 'LUSH', 'BURST'])
                is_premium = any(kw in name_u for kw in ['HONEY', 'GINGER', 'STRAWBERRY', 'STRAWBERY', 'MERRY BERRY'])

                if is_hot:
                    cat = 'Hot Drinks'
                elif is_add_on:
                    cat = 'Add-ons'
                elif is_old_fashioned:
                    cat = 'The Original'
                elif is_shake:
                    cat = 'Frosty Lemonade Shakes'
                elif is_premium:
                    cat = 'Premium Blends'
                else:
                    cat = 'Signature Refreshers'

                # Construct canonical product key & name in Title Case
                name_title = to_title_case(name_clean)
                name_parts = [name_title]
                if variant_clean:
                    v_u = variant_clean.upper()
                    if v_u in ['WSS', 'BSS']:
                        name_parts.append(f"({v_u})")
                    elif v_u == 'HOT':
                        name_parts.append("(Hot)")
                    else:
                        name_parts.append(f"({variant_clean.capitalize()})")
                name_parts.append(size_mapped)
                full_product_name = " ".join(name_parts)

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
                    flavor_ing = 'Mango Pineapple'
                    flavor_grams = 50.0
                elif 'MANGO' in name_u:
                    flavor_ing = 'Mango Puree'
                    if size_clean == '12 OZ': flavor_grams = 100.0
                    elif size_clean == '22 OZ': flavor_grams = 200.0
                    elif size_clean == '1 Liter': flavor_grams = 350.0
                    else: flavor_grams = 50.0
                elif 'WATERMELON SOUR' in name_u:
                    flavor_ing = 'Watermelon Sour'
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
                    flavor_ing = 'Blue Lemonade'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    elif size_clean == '1 Liter': flavor_grams = 200.0
                    else: flavor_grams = 50.0
                elif 'GUYABANO' in name_u:
                    flavor_ing = 'Guyabano'
                    if size_clean == '16 OZ': flavor_grams = 75.0
                    elif size_clean == '22 OZ': flavor_grams = 100.0
                    else: flavor_grams = 50.0
                elif 'MONSTER' in name_u:
                    flavor_ing = 'Monster Energy'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    else: flavor_grams = 50.0
                elif 'ORANGE' in name_u:
                    flavor_ing = 'Orange'
                    if size_clean == '22 OZ': flavor_grams = 100.0
                    else: flavor_grams = 50.0
                elif 'DRAGONFRUIT' in name_u:
                    flavor_ing = 'Dragonfruit'
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

                sugar_ml = get_sugar_ml(name_u, size_clean)
                if sugar_ml > 0:
                    sugar_ing = 'Brown Sugar' if variant_clean == 'BSS' else 'White Sugar'
                    recipe_lines.append({'ingredientName': sugar_ing, 'qty': sugar_ml})

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
                size_part = f"-{size_mapped.upper().replace(' ', '')}"
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
                        'size': size_mapped,
                        'variant': variant_clean,
                        'sku': final_sku,
                        'type': 'READY_MADE' if 'ADD ON' in name_u and not recipe_lines else 'RECIPE',
                        'price': price_num or 100.0,
                        'cost': get_product_cost(full_product_name, recipe_lines),
                        'recipeLines': recipe_lines,
                    }
                elif price_num is not None:
                    all_products[full_product_name]['price'] = price_num

                # Check sales numbers for today
                if cash_q == 0 and cash_a > 0:
                    cash_q = round(cash_a / price_num, 2) if price_num else 1.0
                if ew_q == 0 and ew_a > 0:
                    ew_q = round(ew_a / price_num, 2) if price_num else 1.0
                if gr_q == 0 and gr_a > 0:
                    gr_q = round(gr_a / price_num, 2) if price_num else 1.0
                if sn_q == 0 and sn_a > 0:
                    sn_q = round(sn_a / price_num, 2) if price_num else 1.0

                calc_q = cash_q + ew_q + gr_q + sn_q
                calc_a = cash_a + ew_a + gr_a + sn_a
                if tot_q == 0 and calc_q > 0:
                    tot_q = calc_q
                if tot_a == 0 and calc_a > 0:
                    tot_a = calc_a

                if tot_q > 0 or tot_a > 0:
                    day_sold_items.append({
                        'productName': full_product_name,
                        'price': price_num or (tot_a / tot_q if tot_q > 0 else tot_a),
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

        # Normalize Oct 10 & Oct 11 expense cells where sheet total expenses and balance for deposit
        # were entered manually by the cashier
        if date_str == '2026-10-10':
            # E1550 had total expense 1725 (1500 store expense + 225 food allowance in G1550/E1551)
            summary['EXPENSES'] = 1500.0
            summary['FOOD ALLOWANCE'] = 225.0
        elif date_str == '2026-10-11':
            # 12099 cash sales - 11874 balance for deposit = 225 food allowance
            summary['FOOD ALLOWANCE'] = 225.0

        # Reconcile day_sold_items channel amounts with summary['TOTAL SALES']
        # (e.g. when EWALLET SALES in the summary subtracts a senior e-wallet discount)
        sheet_total_sales = summary.get('TOTAL SALES', day_total_sales)
        items_diff = round(day_total_sales - sheet_total_sales, 2)
        if items_diff != 0 and day_sold_items:
            remaining = items_diff
            # Prefer adjusting ewalletAmount first, then cashAmount
            for field in ['ewalletAmount', 'cashAmount']:
                if remaining == 0:
                    break
                candidates = sorted(
                    [it for it in day_sold_items if it[field] > remaining],
                    key=lambda x: x[field],
                    reverse=True,
                )
                if candidates:
                    target = candidates[0]
                    target[field] = round(target[field] - remaining, 2)
                    target['totalAmount'] = round(
                        target['cashAmount'] + target['ewalletAmount'] + target['grabAmount'] + target['seniorAmount'],
                        2,
                    )
                    remaining = 0
            day_total_sales = round(sum(it['totalAmount'] for it in day_sold_items), 2)

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
                    'WATERMELON SOUR': 'Watermelon Sour',
                    'BLUE LEMONADE': 'Blue Lemonade',
                    'GUYABANO': 'Guyabano',
                    'MANGO PINEAPPLE': 'Mango Pineapple',
                    'MONSTER LEMONADE': 'Monster Energy',
                    'ORANGE LEMONADE': 'Orange',
                    'DRAGONFRUIT LEMONADE': 'Dragonfruit',
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
                    'WSS': 'White Sugar',
                    'BSS': 'Brown Sugar',
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
