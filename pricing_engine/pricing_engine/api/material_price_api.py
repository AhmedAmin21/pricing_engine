import frappe
from frappe import _

@frappe.whitelist()
def get_material_price(item_code):
    price = frappe.db.get_value("Initial Price", 
        {"item_code": item_code, "pricing_plan": "Manufactured", "docstatus": 0}, 
        "material_price_usd")
    return price
