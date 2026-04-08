package ucp

// Negotiate computes the intersection of requested capabilities with
// supported capabilities. Extensions whose parent is not in the
// intersection are pruned.
func Negotiate(requested []string) []Capability {
	if len(requested) == 0 {
		return SupportedCapabilities
	}

	requestedSet := make(map[string]bool)
	for _, name := range requested {
		requestedSet[name] = true
	}

	// First pass: include capabilities present in both sets
	var active []Capability
	for _, cap := range SupportedCapabilities {
		if requestedSet[cap.Name] {
			active = append(active, cap)
		}
	}

	// Prune extensions whose parent is missing (repeat until stable)
	for {
		activeSet := make(map[string]bool)
		for _, cap := range active {
			activeSet[cap.Name] = true
		}

		var pruned []Capability
		changed := false
		for _, cap := range active {
			if cap.Extends != "" && !activeSet[cap.Extends] {
				changed = true
				continue
			}
			pruned = append(pruned, cap)
		}
		active = pruned
		if !changed {
			break
		}
	}

	return active
}
