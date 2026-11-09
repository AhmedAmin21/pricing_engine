import frappe
from frappe import _
import json

# ============================================
# GET FILTERED ITEMS (Excel-style filter)
# ============================================

@frappe.whitelist()
def get_filtered_items(filters):
    if isinstance(filters, str):
        filters = json.loads(filters)

    if not filters:
        return []

    VALID_FIELDS = {
        'item_group', 'brand', 'item_name', 'stock_uom',
        'is_stock_item', 'is_sales_item', 'is_purchase_item',
        'standard_rate', 'valuation_rate', 'description',
        'disabled', 'name'
    }

    NUMERIC_FIELDS = {'standard_rate', 'valuation_rate'}
    CHECK_FIELDS = {'is_stock_item', 'is_sales_item', 'is_purchase_item', 'disabled'}

    conditions = []
    values = []

    for f in filters:
        field = f.get('field')
        condition = f.get('condition')
        value = f.get('value')

        if field not in VALID_FIELDS or not condition:
            continue

        if field in CHECK_FIELDS:
            value = str(value).lower().strip()
            value = 1 if value in ('yes', 'true', '1', 'y') else 0

        elif field in NUMERIC_FIELDS:
            try:
                value = float(value)
            except ValueError:
                continue

        if condition == '=':
            conditions.append(f"`tabItem`.`{field}` = %s")
            values.append(value)
        elif condition == '!=':
            conditions.append(f"`tabItem`.`{field}` != %s")
            values.append(value)
        elif condition == 'like':
            conditions.append(f"`tabItem`.`{field}` LIKE %s")
            values.append(f"%{value}%")
        elif condition == 'not like':
            conditions.append(f"`tabItem`.`{field}` NOT LIKE %s")
            values.append(f"%{value}%")
        elif condition == 'in':
            in_vals = [v.strip() for v in str(value).split(',') if v.strip()]
            if not in_vals:
                continue
            placeholders = ', '.join(['%s'] * len(in_vals))
            conditions.append(f"`tabItem`.`{field}` IN ({placeholders})")
            values.extend(in_vals)
        elif condition == 'not in':
            not_vals = [v.strip() for v in str(value).split(',') if v.strip()]
            if not not_vals:
                continue
            placeholders = ', '.join(['%s'] * len(not_vals))
            conditions.append(f"`tabItem`.`{field}` NOT IN ({placeholders})")
            values.extend(not_vals)
        elif condition == 'is':
            if str(value).lower() in ('null', 'none', ''):
                conditions.append(f"`tabItem`.`{field}` IS NULL")
            else:
                conditions.append(f"`tabItem`.`{field}` = %s")
                values.append(value)
        elif condition in ('>', '<', '>=', '<='):
            conditions.append(f"`tabItem`.`{field}` {condition} %s")
            values.append(value)

    if not conditions:
        return []

    where_clause = " AND ".join(conditions)
    has_disabled = any(f.get('field') == 'disabled' for f in filters)
    if not has_disabled:
        where_clause += " AND `tabItem`.`disabled` = 0"

    query = f"""
        SELECT `name`, `item_name`, `item_group`, `brand`, `stock_uom`,
               `standard_rate`, `valuation_rate`, `description`
        FROM `tabItem`
        WHERE {where_clause}
        ORDER BY `name`
        LIMIT 500
    """

    try:
        return frappe.db.sql(query, tuple(values), as_dict=True)
    except Exception as e:
        frappe.log_error(f"Filter Error: {str(e)}", "Pricing Engine")
        frappe.throw(_("Error fetching items. Check filter conditions."))


# ============================================
# GET LATEST INITIAL PRICES
# ============================================

@frappe.whitelist()
def get_latest_initial_prices(item_codes, pricing_plan="Imported"):
    if isinstance(item_codes, str):
        item_codes = json.loads(item_codes)

    if not item_codes:
        return {}

    results = {}

    for code in item_codes:
        # Logic based on plan
        if pricing_plan == "Imported":
            query = "SELECT chinese_price FROM `tabInitial Price` WHERE item_code = %s AND docstatus < 2 ORDER BY effective_date DESC, creation DESC LIMIT 1"
            field = "chinese_price"
        else:
            query = "SELECT material_price_usd FROM `tabInitial Price` WHERE item_code = %s AND docstatus < 2 ORDER BY effective_date DESC, creation DESC LIMIT 1"
            field = "material_price_usd"

        price = frappe.db.sql(query, (code,), as_dict=True)

        if price:
            results[code] = price[0].get(field)

    return results


# ============================================
# APPLY TO ITEM PRICES
# ============================================

@frappe.whitelist()
def apply_to_item_prices(docname):
    doc = frappe.get_doc("Pricing Engine", docname)

    if not doc.items:
        frappe.throw(_("No items to apply."))

    # Check which price lists are populated
    pls = {
        "wholesale_usd": doc.wholesale_usd_price_list,
        "wholesale_egp": doc.wholesale_egp_price_list,
        "retail_egp": doc.retail_egp_price_list
    }

    populated = {k: v for k, v in pls.items() if v}

    if not populated:
        frappe.throw(_("Please select at least one Price List."))

    # Validate currencies for populated price lists
    currency_map = {
        "wholesale_usd": "USD",
        "wholesale_egp": "EGP",
        "retail_egp": "EGP"
    }

    for key, pl_name in populated.items():
        expected_currency = currency_map[key]
        actual_currency = frappe.db.get_value("Price List", pl_name, "currency")
        if actual_currency != expected_currency:
            frappe.throw(_("{0} Price List '{1}' must have {2} currency (found {3}).").format(
                key.replace("_", " ").title(), pl_name, expected_currency, actual_currency
            ))

    result = {}

    for key, pl_name in populated.items():
        created = 0
        updated = 0

        for row in doc.items:
            if not row.item_code:
                continue

            if key == "wholesale_usd":
                price = round(row.wholesale_usd_price, 2)
                currency = "USD"
            elif key == "wholesale_egp":
                price = round(row.wholesale_egp_price, 2)
                currency = "EGP"
            else:  # retail_egp
                price = round(row.retail_egp_price, 2)
                currency = "EGP"

            res = create_or_update_item_price(row.item_code, pl_name, price, currency)
            if res == "created":
                created += 1
            else:
                updated += 1

        result[key] = {"created": created, "updated": updated}

    # Update status
    new_status = "Applied"
    if doc.status == "Applied" or doc.status == "Re-Applied":
        new_status = "Re-Applied"
    
    frappe.db.set_value("Pricing Engine", docname, "status", new_status)
    frappe.db.commit()

    return result


def create_or_update_item_price(item_code, price_list, price_list_rate, currency):
    existing = frappe.db.exists("Item Price", {
        "item_code": item_code,
        "price_list": price_list,
        "selling": 1
    })

    if existing:
        doc = frappe.get_doc("Item Price", existing)
        doc.price_list_rate = price_list_rate
        doc.currency = currency
        doc.save()
        return "updated"
    else:
        doc = frappe.new_doc("Item Price")
        doc.item_code = item_code
        doc.price_list = price_list
        doc.price_list_rate = price_list_rate
        doc.currency = currency
        doc.selling = 1
        doc.insert()
        return "created"
