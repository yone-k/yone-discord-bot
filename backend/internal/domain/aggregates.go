package domain

import "strings"

func sameString(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func ValidateReorder(current, ids []string) error {
	if len(current) != len(ids) {
		return Fail(CodeInvalidInput, "ids", "Reordering requires every item exactly once")
	}
	seen := map[string]bool{}
	for _, id := range current {
		seen[id] = true
	}
	for _, id := range ids {
		if !seen[id] {
			return Fail(CodeInvalidInput, id, "Reordering requires every item exactly once")
		}
		delete(seen, id)
	}
	return nil
}
func ValidateListItems(items []ListItem) error {
	names := map[string]bool{}
	for _, i := range items {
		if strings.TrimSpace(i.Name) == "" {
			return Fail(CodeInvalidInput, i.Name, "Empty name")
		}
		if names[i.Name] {
			return DuplicateName(i.Name)
		}
		names[i.Name] = true
		if i.Until != nil {
			if e := ValidateDate(*i.Until); e != nil {
				return e
			}
		}
	}
	return nil
}
func (l *List) Save(expected int64, items []ListItem, newID func() (string, error)) error {
	if e := CheckRevision(l.Channel.EditVersion, expected); e != nil {
		return e
	}
	if e := ValidateListItems(items); e != nil {
		return e
	}
	v, e := NextVersion(l.Channel.EditVersion)
	if e != nil {
		return e
	}
	old := map[string]ListItem{}
	for _, i := range l.Items {
		old[i.Name] = i
	}
	result := make([]ListItem, len(items))
	for n, i := range items {
		if existing, ok := old[i.Name]; ok {
			i.ID = existing.ID
			i.LastNotifiedAt = existing.LastNotifiedAt
		} else {
			i.ID, e = newID()
			if e != nil {
				return e
			}
			i.LastNotifiedAt = nil
		}
		i.ChannelID = l.Channel.ChannelID
		i.Position = n
		result[n] = i
	}
	l.Items = result
	l.Channel.EditVersion = v
	return nil
}
func (l *List) Append(item ListItem) error {
	items := append(append([]ListItem(nil), l.Items...), item)
	if e := ValidateListItems(items); e != nil {
		return e
	}
	if strings.TrimSpace(item.ID) == "" {
		return Fail(CodeInvalidInput, "id", "ID required")
	}
	for _, i := range l.Items {
		if i.ID == item.ID {
			return Fail(CodeConflict, item.ID, "Duplicate ID")
		}
	}
	v, e := NextVersion(l.Channel.EditVersion)
	if e != nil {
		return e
	}
	item.ChannelID = l.Channel.ChannelID
	item.Position = 0
	for _, i := range l.Items {
		if i.Position >= item.Position {
			item.Position = i.Position + 1
		}
	}
	l.Items = append(l.Items, item)
	l.Channel.EditVersion = v
	return nil
}
func (l *List) Update(id string, item ListItem) error {
	items := append([]ListItem(nil), l.Items...)
	found := false
	for n, i := range items {
		if i.ID == id {
			item.ID = i.ID
			item.ChannelID = i.ChannelID
			item.Position = i.Position
			item.LastNotifiedAt = i.LastNotifiedAt
			items[n] = item
			found = true
			break
		}
	}
	if !found {
		return Fail(CodeNotFound, id, "List item does not exist")
	}
	if e := ValidateListItems(items); e != nil {
		return e
	}
	v, e := NextVersion(l.Channel.EditVersion)
	if e != nil {
		return e
	}
	l.Items = items
	l.Channel.EditVersion = v
	return nil
}
func (l *List) Delete(id string) error {
	for n, i := range l.Items {
		if i.ID == id {
			v, e := NextVersion(l.Channel.EditVersion)
			if e != nil {
				return e
			}
			l.Items = append(append([]ListItem(nil), l.Items[:n]...), l.Items[n+1:]...)
			l.Channel.EditVersion = v
			return nil
		}
	}
	return Fail(CodeNotFound, id, "List item does not exist")
}
func (l *List) Reorder(ids []string) error {
	current := make([]string, len(l.Items))
	byID := map[string]ListItem{}
	for n, i := range l.Items {
		current[n] = i.ID
		byID[i.ID] = i
	}
	if e := ValidateReorder(current, ids); e != nil {
		return e
	}
	v, e := NextVersion(l.Channel.EditVersion)
	if e != nil {
		return e
	}
	items := make([]ListItem, len(ids))
	for n, id := range ids {
		i := byID[id]
		i.Position = n
		items[n] = i
	}
	l.Items = items
	l.Channel.EditVersion = v
	return nil
}

// UpdateSettings invalidates open editors for business settings, but not for a
// regenerated Discord message alone.
func (l *List) UpdateSettings(settings ListChannel) error {
	if settings.ChannelID != l.Channel.ChannelID {
		return Fail(CodeInvalidInput, "channelId", "Channel cannot change")
	}
	settings.EditVersion = l.Channel.EditVersion
	if settings.ListTitle != l.Channel.ListTitle || settings.DefaultCategory != l.Channel.DefaultCategory || !sameString(settings.OperationLogThreadID, l.Channel.OperationLogThreadID) {
		version, err := NextVersion(l.Channel.EditVersion)
		if err != nil {
			return err
		}
		settings.EditVersion = version
	}
	l.Channel = settings
	return nil
}
func ValidateInventoryItems(items []InventoryItem) error {
	ids, names := map[string]bool{}, map[string]bool{}
	for _, i := range items {
		if strings.TrimSpace(i.ID) == "" || strings.TrimSpace(i.Name) == "" || ids[i.ID] {
			return Fail(CodeInvalidInput, i.ID, "Empty inventory ID/name or duplicate ID")
		}
		if names[i.Name] {
			return DuplicateName(i.Name)
		}
		ids[i.ID] = true
		names[i.Name] = true
	}
	return nil
}
func (c InventoryCatalog) MatchesSnapshot(expected []InventoryItem) bool {
	if len(c.Items) != len(expected) {
		return false
	}
	for n, i := range c.Items {
		e := expected[n]
		if i.ID != e.ID || i.Name != e.Name || !sameString(i.Category, e.Category) || i.Stock.Compare(e.Stock) != 0 {
			return false
		}
	}
	return true
}
func (c *InventoryCatalog) Apply(expected, items []InventoryItem, referenced map[string]bool) error {
	if e := ValidateInventoryItems(items); e != nil {
		return e
	}
	if !c.MatchesSnapshot(expected) {
		return Fail(CodeConflict, c.Channel.ChannelID, "Inventory has changed")
	}
	ids := map[string]bool{}
	existing := map[string]InventoryItem{}
	for _, i := range items {
		ids[i.ID] = true
	}
	for _, i := range c.Items {
		existing[i.ID] = i
		if !ids[i.ID] && referenced[i.ID] {
			return Fail(CodeReferenced, i.ID, "Inventory is referenced")
		}
	}
	result := make([]InventoryItem, len(items))
	for n, i := range items {
		if old, ok := existing[i.ID]; ok {
			i.EntityID = old.EntityID
		}
		i.ChannelID = c.Channel.ChannelID
		i.Position = n
		result[n] = i
	}
	c.Items = result
	return nil
}
func (c *InventoryCatalog) Append(item InventoryItem) error {
	if e := ValidateInventoryItems(append(append([]InventoryItem(nil), c.Items...), item)); e != nil {
		return e
	}
	item.ChannelID = c.Channel.ChannelID
	item.Position = 0
	for _, i := range c.Items {
		if i.Position >= item.Position {
			item.Position = i.Position + 1
		}
	}
	c.Items = append(c.Items, item)
	return nil
}
func (c *InventoryCatalog) Update(items []InventoryItem) error {
	result := append([]InventoryItem(nil), c.Items...)
	seen := map[string]bool{}
	for _, i := range items {
		if seen[i.ID] {
			return Fail(CodeInvalidInput, i.ID, "Duplicate update")
		}
		seen[i.ID] = true
		found := false
		for n, old := range result {
			if old.ID == i.ID {
				i.EntityID = old.EntityID
				i.ChannelID = old.ChannelID
				i.Position = old.Position
				result[n] = i
				found = true
				break
			}
		}
		if !found {
			return Fail(CodeNotFound, i.ID, "Inventory does not exist")
		}
	}
	if e := ValidateInventoryItems(result); e != nil {
		return e
	}
	c.Items = result
	return nil
}
func (c *InventoryCatalog) Delete(id string, referenced bool) error {
	for n, i := range c.Items {
		if i.ID == id {
			if referenced {
				return Fail(CodeReferenced, id, "Inventory is referenced")
			}
			c.Items = append(append([]InventoryItem(nil), c.Items[:n]...), c.Items[n+1:]...)
			return nil
		}
	}
	return Fail(CodeNotFound, id, "Inventory does not exist")
}
func (c *InventoryCatalog) Reorder(ids []string) error {
	current := make([]string, len(c.Items))
	byID := map[string]InventoryItem{}
	for n, i := range c.Items {
		current[n] = i.ID
		byID[i.ID] = i
	}
	if e := ValidateReorder(current, ids); e != nil {
		return e
	}
	result := make([]InventoryItem, len(ids))
	for n, id := range ids {
		i := byID[id]
		i.Position = n
		result[n] = i
	}
	c.Items = result
	return nil
}
func (c InventoryCatalog) Shortages(consumption []InventoryConsumption) []Shortage {
	result := []Shortage{}
	for _, ref := range consumption {
		available := Quantity{}
		name := ref.InventoryID
		for _, i := range c.Items {
			if i.ID == ref.InventoryID {
				available = i.Stock
				name = i.Name
				break
			}
		}
		if available.Compare(ref.Consume) < 0 {
			result = append(result, Shortage{InventoryID: ref.InventoryID, Name: name, Required: ref.Consume, Available: available})
		}
	}
	return result
}
func (c *InventoryCatalog) Consume(consumption []InventoryConsumption) error {
	if e := ValidateConsumption(consumption); e != nil {
		return e
	}
	result := append([]InventoryItem(nil), c.Items...)
	for _, ref := range consumption {
		found := false
		for n, i := range result {
			if i.ID == ref.InventoryID {
				stock, e := i.Stock.Subtract(ref.Consume)
				if e != nil {
					return Fail(CodeShortage, i.ID, "Insufficient inventory")
				}
				result[n].Stock = stock
				found = true
				break
			}
		}
		if !found {
			return Fail(CodeNotFound, ref.InventoryID, "Referenced inventory does not exist")
		}
	}
	c.Items = result
	return nil
}
