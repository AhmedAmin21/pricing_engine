import frappe
from frappe.model.document import Document

class InitialPrice(Document):
    def validate(self):
        self.validate_duplicate()
    
    def validate_duplicate(self):
        existing = frappe.db.exists("Initial Price", {
            "item_code": self.item_code,
            "effective_date": self.effective_date,
            "name": ["!=", self.name]
        })
        if existing:
            frappe.throw(
                "An Initial Price already exists for Item {} on {}.".format(
                    self.item_code, self.effective_date
                )
            )
    
    def before_save(self):
        if not self.item_name and self.item_code:
            self.item_name = frappe.db.get_value("Item", self.item_code, "item_name")
