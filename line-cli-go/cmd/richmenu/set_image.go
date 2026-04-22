package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/spf13/cobra"
)

var setImageCmd = &cobra.Command{
	Use:   "set-image",
	Short: "Upload a rich menu image (PNG/JPEG)",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		imagePath, _ := cmd.Flags().GetString("image")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		reader, contentType, err := payload.LoadImage(imagePath)
		if err != nil {
			return err
		}
		defer reader.Close()

		p := output.NewPrinter(config.JSONMode(), nil)
		blob, err := client.NewMessagingBlobAPI()
		if err != nil {
			return err
		}
		if _, err := blob.SetRichMenuImage(richMenuID, contentType, reader); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu image uploaded", map[string]string{
			"richMenuId":  richMenuID,
			"contentType": contentType,
		})
		return nil
	},
}

func init() {
	setImageCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	setImageCmd.Flags().String("image", "", "image file path (use '-' for stdin) (required)")
	_ = setImageCmd.MarkFlagRequired("rich-menu-id")
	_ = setImageCmd.MarkFlagRequired("image")
	RichMenuCmd.AddCommand(setImageCmd)
}
