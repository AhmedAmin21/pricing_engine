frappe.ui.form.on('Initial Price', {
    item_code: function(frm) {
        if (frm.doc.item_code) {
            frappe.db.get_value('Item', frm.doc.item_code, 'item_name')
                .then(r => {
                    if (r && r.message) {
                        frm.set_value('item_name', r.message.item_name);
                    }
                });
        }
    },

    pricing_plan: function(frm) {
        // Clear the price field that is now hidden
        if (frm.doc.pricing_plan === 'Imported') {
            frm.set_value('material_price_usd', 0);
        } else {
            frm.set_value('chinese_price', 0);
        }
    }
});
