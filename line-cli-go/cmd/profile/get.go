package profile

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a user's profile",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		if userID == "" {
			return &config.ClientError{Msg: "--user-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetProfile(userID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}

		p.Raw(map[string]any{
			"userId":        resp.UserId,
			"displayName":   resp.DisplayName,
			"pictureUrl":    resp.PictureUrl,
			"statusMessage": resp.StatusMessage,
			"language":      resp.Language,
		})
		return nil
	},
}

func init() {
	getCmd.Flags().String("user-id", "", "LINE user ID (required)")
	_ = getCmd.MarkFlagRequired("user-id")
}
