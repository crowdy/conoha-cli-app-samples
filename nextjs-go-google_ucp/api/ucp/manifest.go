package ucp

type Manifest struct {
	UCP     UCPSection     `json:"ucp"`
	Payment PaymentSection `json:"payment"`
}

type UCPSection struct {
	Version      string             `json:"version"`
	Services     map[string]Service `json:"services"`
	Capabilities []Capability       `json:"capabilities"`
}

type Service struct {
	Version string      `json:"version"`
	Spec    string      `json:"spec"`
	REST    RESTBinding `json:"rest"`
}

type RESTBinding struct {
	Schema   string `json:"schema"`
	Endpoint string `json:"endpoint"`
}

type Capability struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Spec    string `json:"spec,omitempty"`
	Schema  string `json:"schema,omitempty"`
	Extends string `json:"extends,omitempty"`
}

type PaymentSection struct {
	Handlers []PaymentHandler `json:"handlers"`
}

type PaymentHandler struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Config map[string]string `json:"config"`
}

const UCPVersion = "2026-01-23"

var SupportedCapabilities = []Capability{
	{
		Name:    "dev.ucp.shopping.checkout",
		Version: UCPVersion,
		Spec:    "https://ucp.dev/specs/shopping/checkout",
		Schema:  "https://ucp.dev/schemas/shopping/checkout.json",
	},
	{
		Name:    "dev.ucp.shopping.discount",
		Version: UCPVersion,
		Extends: "dev.ucp.shopping.checkout",
	},
}

func BuildManifest(endpoint string) Manifest {
	return Manifest{
		UCP: UCPSection{
			Version: UCPVersion,
			Services: map[string]Service{
				"dev.ucp.shopping": {
					Version: UCPVersion,
					Spec:    "https://ucp.dev/specs/shopping",
					REST: RESTBinding{
						Schema:   "https://ucp.dev/services/shopping/openapi.json",
						Endpoint: endpoint,
					},
				},
			},
			Capabilities: SupportedCapabilities,
		},
		Payment: PaymentSection{
			Handlers: []PaymentHandler{
				{
					ID:   "mock_google_pay",
					Name: "google.pay",
					Config: map[string]string{
						"merchant_name": "UCP Demo Flower Shop",
						"environment":   "TEST",
					},
				},
			},
		},
	}
}
